import type { ExamplePlate } from './examples';

export default function ExampleGallery({
  examples,
  onOpen,
  onUseNote,
}: {
  examples: ExamplePlate[];
  onOpen: (example: ExamplePlate) => void;
  onUseNote: (note: string) => void;
}) {
  return (
    <section className="example-gallery" aria-labelledby="example-gallery-title">
      <div className="example-gallery-head">
        <div><div className="eyebrow eyebrow-accent">Completed plates</div><h2 id="example-gallery-title">See the result before bringing your data.</h2></div>
        <p>Each example opens locally with a finished recipe. Use its Note and Chef prompts as patterns for your own analysis.</p>
      </div>
      <div className="example-grid">
        {examples.map((example, index) => (
          <article className="example-card" key={example.id}>
            <button type="button" className="example-open" data-example={example.id} onClick={() => onOpen(example)}>
              <div className={`plate-preview preview-${index % 4}`}>
                <span className="plate-kpi" />
                <span className="plate-kpi" />
                <span className="plate-chart"><i /><i /><i /><i /></span>
              </div>
              <span className="eyebrow">{example.category}</span>
              <strong>{example.title}</strong>
              <span>{example.description}</span>
              <em>Open completed plate →</em>
            </button>
            <div className="example-teaching">
              <button type="button" onClick={() => onUseNote(example.noteExample)}><b>Note</b> “{example.noteExample}”</button>
              <p><b>Chef</b> “{example.chefExample}”</p>
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
