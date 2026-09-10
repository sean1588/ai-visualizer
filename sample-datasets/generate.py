#!/usr/bin/env python3

import argparse
import csv
import filecmp
import hashlib
import json
import math
import random
import sys
import tempfile
from datetime import date, timedelta
from pathlib import Path


SEED = 20260910


def weighted(rng, values):
    choices, weights = zip(*values)
    return rng.choices(choices, weights=weights, k=1)[0]


def clamp(value, lower, upper):
    return max(lower, min(upper, value))


def money(value):
    return round(value, 2)


def ratio(value):
    return round(clamp(value, 0, 1), 4)


def write_dataset(output_dir, name, fields, rows):
    csv_path = output_dir / f"{name}.csv"
    json_path = output_dir / f"{name}.json"
    count = 0
    with csv_path.open("w", encoding="utf-8", newline="") as csv_file, json_path.open(
        "w", encoding="utf-8", newline="\n"
    ) as json_file:
        writer = csv.DictWriter(csv_file, fieldnames=fields, lineterminator="\n")
        writer.writeheader()
        json_file.write("[\n")
        for row in rows:
            if count:
                json_file.write(",\n")
            writer.writerow(row)
            json_file.write("  ")
            json.dump(row, json_file, ensure_ascii=False, separators=(",", ":"))
            count += 1
        json_file.write("\n]\n")
    return count, csv_path, json_path


def product_usage_rows(rng, account_count=500, week_count=26):
    plans = {
        "Free": {"weight": 32, "seats": 4, "mrr": 0, "usage": 0.52},
        "Starter": {"weight": 30, "seats": 12, "mrr": 149, "usage": 0.64},
        "Growth": {"weight": 28, "seats": 42, "mrr": 799, "usage": 0.75},
        "Enterprise": {"weight": 10, "seats": 180, "mrr": 4200, "usage": 0.82},
    }
    regions = [("North America", 45), ("EMEA", 28), ("APAC", 20), ("Latin America", 7)]
    industries = [
        ("Software", 30),
        ("Financial Services", 16),
        ("Healthcare", 13),
        ("Retail", 13),
        ("Professional Services", 18),
        ("Manufacturing", 10),
    ]
    channels = [
        ("Organic", 30),
        ("Paid Search", 18),
        ("Content", 20),
        ("Partner", 17),
        ("Outbound", 15),
    ]
    accounts = []
    for index in range(account_count):
        plan = weighted(rng, [(name, config["weight"]) for name, config in plans.items()])
        config = plans[plan]
        health = clamp(rng.gauss(config["usage"], 0.13), 0.18, 0.98)
        seats = max(1, round(rng.lognormvariate(math.log(config["seats"]), 0.45)))
        accounts.append(
            {
                "account_id": f"acct_{index + 1:05d}",
                "plan": plan,
                "region": weighted(rng, regions),
                "industry": weighted(rng, industries),
                "acquisition_channel": weighted(rng, channels),
                "starting_age_weeks": rng.randint(4, 180),
                "seats": seats,
                "base_health": health,
                "base_mrr": config["mrr"] * (0.75 + seats / max(1, config["seats"]) * 0.25),
            }
        )

    start = date(2026, 1, 5)
    for week_index in range(week_count):
        week = start + timedelta(days=7 * week_index)
        seasonal = 1 + 0.05 * math.sin(week_index / 3.4)
        for account in accounts:
            age = account["starting_age_weeks"] + week_index
            health = clamp(
                account["base_health"] + week_index * 0.0025 + rng.gauss(0, 0.045),
                0.08,
                0.99,
            )
            seats = max(1, round(account["seats"] * (1 + week_index * rng.uniform(0.0005, 0.004))))
            active_users = min(seats, max(0, round(seats * health * seasonal + rng.gauss(0, 1.8))))
            invited_users = max(active_users, round(seats * clamp(health + rng.uniform(0.05, 0.25), 0, 1)))
            sessions = max(active_users, round(active_users * rng.uniform(2.4, 7.8)))
            core_actions = max(0, round(sessions * rng.uniform(1.8, 5.6) * health))
            feature_a_users = min(active_users, round(active_users * clamp(health - 0.08 + week_index * 0.006, 0, 1)))
            feature_b_users = min(active_users, round(active_users * clamp(health - 0.24 + week_index * 0.004, 0, 1)))
            activation_rate = ratio((feature_a_users + feature_b_users) / max(1, invited_users * 2))
            retention = ratio(health - 0.05 + rng.gauss(0, 0.04))
            support_tickets = max(0, round(seats / 45 + (1 - health) * 4 + rng.gauss(0, 1)))
            expansion = max(0, account["base_mrr"] * max(0, rng.gauss(0.006 + week_index * 0.0002, 0.012)))
            mrr = 0 if account["plan"] == "Free" else account["base_mrr"] * (1 + week_index * 0.004)
            churn_probability = clamp((0.50 - health) * 0.08 + support_tickets * 0.0015, 0.001, 0.08)
            churned = week_index == week_count - 1 and rng.random() < churn_probability * 5
            nps = None
            if week_index % 4 == index % 4 and rng.random() < 0.72:
                nps = round(clamp((health - 0.5) * 140 + rng.gauss(20, 18), -100, 100))
            yield {
                "week_start": week.isoformat(),
                "account_id": account["account_id"],
                "plan": account["plan"],
                "region": account["region"],
                "industry": account["industry"],
                "acquisition_channel": account["acquisition_channel"],
                "account_age_weeks": age,
                "seats": seats,
                "weekly_active_users": active_users,
                "invited_users": invited_users,
                "sessions": sessions,
                "core_actions": core_actions,
                "feature_a_users": feature_a_users,
                "feature_b_users": feature_b_users,
                "activation_rate": activation_rate,
                "retention_rate_4w": retention,
                "nps_score": nps,
                "mrr_usd": money(mrr),
                "expansion_mrr_usd": money(expansion),
                "support_tickets": support_tickets,
                "churned": churned,
            }


def ecommerce_order_rows(rng, row_count=20000):
    products = [
        ("Electronics", "Wireless Headphones", 129, 0.54),
        ("Electronics", "Smart Home Hub", 179, 0.58),
        ("Home", "Linen Sheet Set", 119, 0.46),
        ("Home", "Ceramic Cookware", 210, 0.49),
        ("Fitness", "Adjustable Kettlebell", 145, 0.52),
        ("Fitness", "Recovery Roller", 55, 0.41),
        ("Beauty", "Daily Skin Set", 89, 0.38),
        ("Beauty", "Hair Styling Kit", 135, 0.44),
        ("Apparel", "Performance Jacket", 165, 0.47),
        ("Apparel", "Everyday Sneaker", 110, 0.45),
    ]
    regions = [
        ("North America", "United States", 42),
        ("North America", "Canada", 8),
        ("EMEA", "United Kingdom", 12),
        ("EMEA", "Germany", 9),
        ("EMEA", "France", 7),
        ("APAC", "Australia", 8),
        ("APAC", "Japan", 8),
        ("Latin America", "Brazil", 6),
    ]
    channels = [("Direct", 36), ("Paid Search", 22), ("Social", 18), ("Marketplace", 14), ("Affiliate", 10)]
    segments = [("New", 24), ("Occasional", 33), ("Loyal", 28), ("VIP", 15)]
    campaigns = {
        "Direct": [None, "Email Lifecycle", "Referral"],
        "Paid Search": ["Brand Search", "Nonbrand Search", "Shopping Ads"],
        "Social": ["Creator Program", "Prospecting", "Retargeting"],
        "Marketplace": [None, "Marketplace Featured"],
        "Affiliate": ["Publisher Network", "Cashback Partner"],
    }
    first_seen = set()
    start = date(2025, 1, 1)
    total_days = 548
    for index in range(row_count):
        category, product, base_price, cogs_ratio = rng.choice(products)
        day_index = min(total_days - 1, max(0, round(index * total_days / row_count + rng.gauss(0, 4))))
        order_date = start + timedelta(days=day_index)
        region, country, _ = weighted(rng, [((region, country, weight), weight) for region, country, weight in regions])
        channel = weighted(rng, channels)
        segment = weighted(rng, segments)
        customer_number = rng.randint(1, 7200)
        customer_id = f"cust_{customer_number:05d}"
        first_order = customer_id not in first_seen
        first_seen.add(customer_id)
        units = weighted(rng, [(1, 68), (2, 21), (3, 7), (4, 3), (5, 1)])
        unit_price = base_price * rng.uniform(0.92, 1.10)
        discount = clamp(
            rng.choice([0, 0, 0.05, 0.10, 0.15, 0.20]) + (0.05 if segment == "VIP" else 0),
            0,
            0.35,
        )
        gross = units * unit_price
        discount_amount = gross * discount
        status = weighted(rng, [("Delivered", 86), ("Returned", 7), ("Refunded", 3), ("Cancelled", 2), ("In Transit", 2)])
        refund = 0
        if status == "Returned":
            refund = gross * rng.uniform(0.65, 1)
        elif status == "Refunded":
            refund = gross - discount_amount
        elif status == "Cancelled":
            refund = 0
        shipping = 0 if segment == "VIP" or gross >= 150 else rng.uniform(5.5, 14)
        fulfillment_days = None if status == "Cancelled" else max(1, round(rng.gauss(3.8 if region == "North America" else 5.6, 1.8)))
        cogs = gross * cogs_ratio
        net = gross - discount_amount - refund
        margin = net - cogs - shipping
        yield {
            "order_id": f"ord_{index + 1:07d}",
            "order_date": order_date.isoformat(),
            "customer_id": customer_id,
            "customer_segment": segment,
            "region": region,
            "country": country,
            "sales_channel": channel,
            "campaign": rng.choice(campaigns[channel]),
            "product_category": category,
            "product_name": product,
            "sku": f"{category[:3].upper()}-{products.index((category, product, base_price, cogs_ratio)) + 1:03d}",
            "units": units,
            "unit_price_usd": money(unit_price),
            "discount_pct": ratio(discount),
            "gross_revenue_usd": money(gross),
            "discount_amount_usd": money(discount_amount),
            "refund_amount_usd": money(refund),
            "shipping_cost_usd": money(shipping),
            "cogs_usd": money(cogs),
            "net_revenue_usd": money(net),
            "gross_margin_usd": money(margin),
            "fulfillment_days": fulfillment_days,
            "status": status,
            "first_order": first_order,
        }


def support_ticket_rows(rng, row_count=12000):
    plans = [("Free", 24), ("Starter", 31), ("Growth", 31), ("Enterprise", 14)]
    regions = [("North America", 47), ("EMEA", 27), ("APAC", 19), ("Latin America", 7)]
    channels = [("Email", 42), ("In App", 28), ("Chat", 20), ("Phone", 10)]
    issues = [
        ("How To", 24, 0.55),
        ("Billing", 16, 0.70),
        ("Bug", 23, 1.25),
        ("Performance", 12, 1.35),
        ("Integration", 15, 1.15),
        ("Account Access", 10, 0.65),
    ]
    priorities = [("Low", 28), ("Normal", 48), ("High", 19), ("Urgent", 5)]
    teams = {
        "How To": "Customer Education",
        "Billing": "Billing Operations",
        "Bug": "Product Support",
        "Performance": "Technical Support",
        "Integration": "Technical Support",
        "Account Access": "Account Support",
    }
    sla_hours = {"Low": 72, "Normal": 36, "High": 12, "Urgent": 4}
    plan_arr = {"Free": 0, "Starter": 1800, "Growth": 12000, "Enterprise": 85000}
    start = date(2025, 7, 1)
    total_days = 365
    for index in range(row_count):
        day_index = min(total_days - 1, max(0, round(index * total_days / row_count + rng.gauss(0, 2))))
        created = start + timedelta(days=day_index)
        plan = weighted(rng, plans)
        region = weighted(rng, regions)
        channel = weighted(rng, channels)
        issue_type, _, complexity = weighted(rng, [((name, weight, factor), weight) for name, weight, factor in issues])
        priority = weighted(rng, priorities)
        target = sla_hours[priority]
        queue_pressure = 1 + 0.25 * math.sin(day_index / 21) + (0.35 if created.weekday() == 0 else 0)
        plan_speed = {"Free": 1.35, "Starter": 1.1, "Growth": 0.85, "Enterprise": 0.55}[plan]
        response_minutes = max(2, round(rng.lognormvariate(math.log(45 * complexity * queue_pressure * plan_speed), 0.65)))
        resolution_hours = max(0.2, rng.lognormvariate(math.log(9 * complexity * queue_pressure * plan_speed), 0.72))
        open_ticket = index >= row_count - 500 and rng.random() < 0.38
        status = weighted(rng, [("Open", 45), ("Pending Customer", 35), ("Escalated", 20)]) if open_ticket else "Resolved"
        escalated = status == "Escalated" or rng.random() < clamp(complexity * 0.045 + (0.06 if priority == "Urgent" else 0), 0, 0.3)
        reopened = not open_ticket and rng.random() < clamp(complexity * 0.055, 0.01, 0.18)
        breached = resolution_hours > target or (open_ticket and (date(2026, 6, 30) - created).days * 24 > target)
        resolved = None if open_ticket else created + timedelta(days=max(0, math.ceil(resolution_hours / 24)))
        csat = None
        if not open_ticket and rng.random() < 0.68:
            csat = round(clamp(5.15 - response_minutes / 500 - resolution_hours / 80 - int(escalated) * 0.5 + rng.gauss(0, 0.55), 1, 5), 1)
        sentiment = clamp(rng.gauss(0.35 - int(escalated) * 0.35 - int(breached) * 0.25, 0.34), -1, 1)
        account_number = rng.randint(1, 5200)
        arr = plan_arr[plan] * rng.lognormvariate(0, 0.45) if plan_arr[plan] else 0
        yield {
            "ticket_id": f"tkt_{index + 1:07d}",
            "created_date": created.isoformat(),
            "resolved_date": resolved.isoformat() if resolved else None,
            "account_id": f"acct_{account_number:05d}",
            "plan": plan,
            "region": region,
            "channel": channel,
            "issue_type": issue_type,
            "priority": priority,
            "assigned_team": teams[issue_type],
            "status": status,
            "first_response_minutes": response_minutes,
            "resolution_hours": None if open_ticket else round(resolution_hours, 2),
            "sla_target_hours": target,
            "sla_breached": breached,
            "csat_score": csat,
            "reopened": reopened,
            "escalated": escalated,
            "message_count": max(1, round(rng.gauss(4 + complexity * 2 + int(escalated) * 3, 2))),
            "customer_arr_usd": money(arr),
            "customer_tenure_days": rng.randint(1, 1800),
            "sentiment_score": round(sentiment, 3),
        }


DATASETS = [
    {
        "name": "product-usage-weekly",
        "description": "Weekly account-level SaaS usage, adoption, retention, expansion, and churn signals.",
        "use_cases": ["feature adoption", "retention analysis", "account health", "plan and region segmentation"],
        "fields": [
            "week_start",
            "account_id",
            "plan",
            "region",
            "industry",
            "acquisition_channel",
            "account_age_weeks",
            "seats",
            "weekly_active_users",
            "invited_users",
            "sessions",
            "core_actions",
            "feature_a_users",
            "feature_b_users",
            "activation_rate",
            "retention_rate_4w",
            "nps_score",
            "mrr_usd",
            "expansion_mrr_usd",
            "support_tickets",
            "churned",
        ],
        "factory": product_usage_rows,
    },
    {
        "name": "ecommerce-orders",
        "description": "Order-level commerce performance with channels, products, discounts, refunds, and margin.",
        "use_cases": ["revenue analysis", "channel performance", "product mix", "refund and margin analysis"],
        "fields": [
            "order_id",
            "order_date",
            "customer_id",
            "customer_segment",
            "region",
            "country",
            "sales_channel",
            "campaign",
            "product_category",
            "product_name",
            "sku",
            "units",
            "unit_price_usd",
            "discount_pct",
            "gross_revenue_usd",
            "discount_amount_usd",
            "refund_amount_usd",
            "shipping_cost_usd",
            "cogs_usd",
            "net_revenue_usd",
            "gross_margin_usd",
            "fulfillment_days",
            "status",
            "first_order",
        ],
        "factory": ecommerce_order_rows,
    },
    {
        "name": "support-tickets",
        "description": "Customer-support operations with SLA, resolution, CSAT, escalation, and account context.",
        "use_cases": ["SLA reporting", "support capacity", "issue trends", "customer experience"],
        "fields": [
            "ticket_id",
            "created_date",
            "resolved_date",
            "account_id",
            "plan",
            "region",
            "channel",
            "issue_type",
            "priority",
            "assigned_team",
            "status",
            "first_response_minutes",
            "resolution_hours",
            "sla_target_hours",
            "sla_breached",
            "csat_score",
            "reopened",
            "escalated",
            "message_count",
            "customer_arr_usd",
            "customer_tenure_days",
            "sentiment_score",
        ],
        "factory": support_ticket_rows,
    },
]


def digest(path):
    checksum = hashlib.sha256()
    with path.open("rb") as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b""):
            checksum.update(chunk)
    return checksum.hexdigest()


def generate(output_dir):
    output_dir.mkdir(parents=True, exist_ok=True)
    manifest = {"seed": SEED, "datasets": []}
    for offset, spec in enumerate(DATASETS):
        rng = random.Random(SEED + offset)
        count, csv_path, json_path = write_dataset(
            output_dir,
            spec["name"],
            spec["fields"],
            spec["factory"](rng),
        )
        manifest["datasets"].append(
            {
                "name": spec["name"],
                "description": spec["description"],
                "use_cases": spec["use_cases"],
                "rows": count,
                "columns": len(spec["fields"]),
                "files": {
                    "csv": {
                        "path": csv_path.name,
                        "bytes": csv_path.stat().st_size,
                        "sha256": digest(csv_path),
                    },
                    "json": {
                        "path": json_path.name,
                        "bytes": json_path.stat().st_size,
                        "sha256": digest(json_path),
                    },
                },
            }
        )
    with (output_dir / "manifest.json").open("w", encoding="utf-8", newline="\n") as file:
        json.dump(manifest, file, indent=2)
        file.write("\n")


def check(committed_dir):
    with tempfile.TemporaryDirectory(prefix="mise-samples-") as temp:
        generated_dir = Path(temp)
        generate(generated_dir)
        expected = ["manifest.json"] + [
            f"{spec['name']}.{extension}"
            for spec in DATASETS
            for extension in ("csv", "json")
        ]
        changed = [
            name
            for name in expected
            if not (committed_dir / name).exists()
            or not filecmp.cmp(committed_dir / name, generated_dir / name, shallow=False)
        ]
    if changed:
        print("Generated sample datasets are stale:", ", ".join(changed), file=sys.stderr)
        return 1
    print(f"Sample datasets are reproducible ({len(DATASETS)} datasets).")
    return 0


def main():
    parser = argparse.ArgumentParser(description="Generate deterministic synthetic datasets for Mise.")
    parser.add_argument(
        "--output-dir",
        type=Path,
        default=Path(__file__).resolve().parent,
        help="Directory for generated CSV, JSON, and manifest files.",
    )
    parser.add_argument(
        "--check",
        action="store_true",
        help="Regenerate in a temporary directory and compare with committed files.",
    )
    args = parser.parse_args()
    if args.check:
        return check(args.output_dir)
    generate(args.output_dir)
    print(f"Generated {len(DATASETS)} datasets in {args.output_dir}.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
