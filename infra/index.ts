/**
 * Mise · production infra.
 *
 * Topology:
 *   client ──▶ CloudFront ──▶ S3 (static)         path: /*
 *                          └▶ Lambda Function URL  path: /api/*
 *
 * One distribution, one TLS cert, one DNS record. The Lambda holds the
 * OpenRouter API key as an env var; the browser bundle never sees it.
 */

import * as path from "path";
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";
import * as syncedFolder from "@pulumi/synced-folder";

const cfg = new pulumi.Config();
const domain = cfg.require("domain");                         // app.mise.seanholung.com
const rootZone = cfg.require("rootZone");                     // seanholung.com
const llmModel = cfg.get("llmModel") || "moonshotai/kimi-k2.6";
const llmBaseUrl = cfg.get("llmBaseUrl") || "https://openrouter.ai/api/v1";

// API key is injected from the GitHub Actions secret OPENROUTER_API_KEY at deploy time.
const openrouterApiKey = process.env.OPENROUTER_API_KEY;
if (!openrouterApiKey) {
  throw new Error("OPENROUTER_API_KEY env var is required for `pulumi up`.");
}

const tags = { project: "mise-app", env: pulumi.getStack() };

// ──────────────── Static origin (S3) ────────────────

const siteBucket = new aws.s3.BucketV2("site", {
  forceDestroy: true,
  tags,
});

new aws.s3.BucketPublicAccessBlock("site-pab", {
  bucket: siteBucket.id,
  blockPublicAcls: true,
  blockPublicPolicy: true,
  ignorePublicAcls: true,
  restrictPublicBuckets: true,
});

new aws.s3.BucketOwnershipControls("site-own", {
  bucket: siteBucket.id,
  rule: { objectOwnership: "BucketOwnerEnforced" },
});

// Mirror ../public into the bucket on every `pulumi up`.
new syncedFolder.S3BucketFolder("site-content", {
  path: path.join(__dirname, "..", "public"),
  bucketName: siteBucket.bucket,
  acl: "private",
  managedObjects: false, // Pulumi doesn't track each file as a resource (cheaper diffs).
});

// ──────────────── Lambda (LLM proxy) ────────────────

const lambdaRole = new aws.iam.Role("cook-role", {
  assumeRolePolicy: JSON.stringify({
    Version: "2012-10-17",
    Statement: [{
      Effect: "Allow",
      Principal: { Service: "lambda.amazonaws.com" },
      Action: "sts:AssumeRole",
    }],
  }),
  tags,
});

new aws.iam.RolePolicyAttachment("cook-role-basic", {
  role: lambdaRole.name,
  policyArn: aws.iam.ManagedPolicy.AWSLambdaBasicExecutionRole,
});

const cookFn = new aws.lambda.Function("cook", {
  runtime: aws.lambda.Runtime.NodeJS22dX,
  role: lambdaRole.arn,
  handler: "cook.handler",
  code: new pulumi.asset.FileArchive(path.join(__dirname, "..", "lambda", "dist")),
  // 90s budget covers the SDK's default 3-attempt retry behavior (15s per
  // attempt × 3 + ~2s of backoff = ~47s worst case) with comfortable
  // headroom. The handler itself is idle most of the time — it's waiting
  // on the upstream HTTP call.
  timeout: 90,
  memorySize: 256,
  environment: {
    variables: {
      LLM_BASE_URL: llmBaseUrl,
      LLM_MODEL: llmModel,
      OPENROUTER_API_KEY: openrouterApiKey,
      OPENROUTER_REFERER: `https://${domain}`,
      OPENROUTER_TITLE: "Mise",
    },
  },
  tags,
});

const cookUrl = new aws.lambda.FunctionUrl("cook-url", {
  functionName: cookFn.name,
  authorizationType: "NONE",
  invokeMode: "BUFFERED",
});

// Public Function URLs need both lambda:InvokeFunctionUrl AND
// lambda:InvokeFunction granted to "*". The Pulumi/Terraform Function URL
// resource auto-creates the InvokeFunctionUrl statement, but invocations
// still 403 without InvokeFunction (the AWS console flags this in the
// Function URL UI). The principal "*" on InvokeFunction does not allow
// unauthenticated AWS-API calls — those still require sigV4 signing — so
// it's only consumed by Function URL invocations in practice.
//
// Note: AWS rejects the FunctionUrlAuthType condition for the
// InvokeFunction action ("only supported for lambda:InvokeFunctionUrl"),
// so we omit it here.
new aws.lambda.Permission("cook-public-invoke-function", {
  action: "lambda:InvokeFunction",
  function: cookFn.name,
  principal: "*",
  statementId: "AllowPublicInvokeFunction",
});

// Strip "https://" and trailing "/" from the function URL for use as a CloudFront origin.
const cookUrlHost = cookUrl.functionUrl.apply(u => u.replace(/^https?:\/\//, "").replace(/\/$/, ""));

// ──────────────── ACM cert in us-east-1 (CloudFront requirement) ────────────────

const usEast1 = new aws.Provider("us-east-1", { region: "us-east-1" });

const cert = new aws.acm.Certificate("cert", {
  domainName: domain,
  validationMethod: "DNS",
  tags,
}, { provider: usEast1 });

const zone = aws.route53.getZoneOutput({ name: rootZone });

const certValidationRecord = new aws.route53.Record("cert-validation", {
  zoneId: zone.zoneId,
  name: cert.domainValidationOptions[0].resourceRecordName,
  type: cert.domainValidationOptions[0].resourceRecordType,
  records: [cert.domainValidationOptions[0].resourceRecordValue],
  ttl: 60,
  allowOverwrite: true,
});

const certValidated = new aws.acm.CertificateValidation("cert-validated", {
  certificateArn: cert.arn,
  validationRecordFqdns: [certValidationRecord.fqdn],
}, { provider: usEast1 });

// ──────────────── CloudFront origin access for S3 ────────────────

const oac = new aws.cloudfront.OriginAccessControl("site-oac", {
  description: "Mise site OAC",
  originAccessControlOriginType: "s3",
  signingBehavior: "always",
  signingProtocol: "sigv4",
});

// ──────────────── CloudFront distribution ────────────────

// AWS-managed cache + origin-request policies (stable IDs).
const CACHE_OPTIMIZED      = "658327ea-f89d-4fab-a63d-7e88639e58f6";
const CACHE_DISABLED       = "4135ea2d-6df8-44a3-9df3-4b5a84be39ad";
const ORIGIN_REQUEST_VIEWER_EXCEPT_HOST = "b689b0a8-53d0-40ab-baf2-68738e2966ac";

const distribution = new aws.cloudfront.Distribution("site", {
  enabled: true,
  isIpv6Enabled: true,
  httpVersion: "http2and3",
  priceClass: "PriceClass_100",
  aliases: [domain],
  defaultRootObject: "index.html",
  origins: [
    {
      originId: "s3-static",
      domainName: siteBucket.bucketRegionalDomainName,
      originAccessControlId: oac.id,
      s3OriginConfig: { originAccessIdentity: "" },
    },
    {
      originId: "lambda-cook",
      domainName: cookUrlHost,
      customOriginConfig: {
        httpPort: 80,
        httpsPort: 443,
        originProtocolPolicy: "https-only",
        originSslProtocols: ["TLSv1.2"],
      },
    },
  ],
  defaultCacheBehavior: {
    targetOriginId: "s3-static",
    viewerProtocolPolicy: "redirect-to-https",
    allowedMethods: ["GET", "HEAD", "OPTIONS"],
    cachedMethods: ["GET", "HEAD"],
    compress: true,
    cachePolicyId: CACHE_OPTIMIZED,
  },
  orderedCacheBehaviors: [
    {
      pathPattern: "/api/*",
      targetOriginId: "lambda-cook",
      viewerProtocolPolicy: "https-only",
      allowedMethods: ["GET", "HEAD", "OPTIONS", "PUT", "POST", "PATCH", "DELETE"],
      cachedMethods: ["GET", "HEAD"],
      compress: true,
      cachePolicyId: CACHE_DISABLED,
      originRequestPolicyId: ORIGIN_REQUEST_VIEWER_EXCEPT_HOST,
    },
  ],
  // No customErrorResponses: CloudFront would otherwise rewrite 403/404 from
  // *any* origin (including the Lambda /api/* path) to index.html, masking
  // real failures. The app is a single page; we don't need SPA-style fallback.
  restrictions: { geoRestriction: { restrictionType: "none" } },
  viewerCertificate: {
    acmCertificateArn: certValidated.certificateArn,
    sslSupportMethod: "sni-only",
    minimumProtocolVersion: "TLSv1.2_2021",
  },
  tags,
});

// Bucket policy: only this distribution can read the bucket.
new aws.s3.BucketPolicy("site-policy", {
  bucket: siteBucket.id,
  policy: pulumi.all([siteBucket.arn, distribution.arn]).apply(([bucketArn, distArn]) =>
    JSON.stringify({
      Version: "2012-10-17",
      Statement: [{
        Effect: "Allow",
        Principal: { Service: "cloudfront.amazonaws.com" },
        Action: "s3:GetObject",
        Resource: `${bucketArn}/*`,
        Condition: { StringEquals: { "AWS:SourceArn": distArn } },
      }],
    }),
  ),
});

// ──────────────── DNS: app.mise.seanholung.com → CloudFront ────────────────

new aws.route53.Record("apex", {
  zoneId: zone.zoneId,
  name: domain,
  type: "A",
  aliases: [{
    name: distribution.domainName,
    zoneId: distribution.hostedZoneId,
    evaluateTargetHealth: false,
  }],
});

new aws.route53.Record("apex-aaaa", {
  zoneId: zone.zoneId,
  name: domain,
  type: "AAAA",
  aliases: [{
    name: distribution.domainName,
    zoneId: distribution.hostedZoneId,
    evaluateTargetHealth: false,
  }],
});

// ──────────────── Outputs ────────────────

export const url = pulumi.interpolate`https://${domain}`;
export const cloudfrontDomain = distribution.domainName;
export const distributionId = distribution.id;
export const lambdaName = cookFn.name;
export const lambdaUrl = cookUrl.functionUrl;
export const bucketName = siteBucket.bucket;
