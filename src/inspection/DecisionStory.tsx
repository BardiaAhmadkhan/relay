import { explainDecision } from './decision';
import type { RecordData } from '../shared/domain';
import { Icon } from '../components/ui';
export function DecisionStory({
  record,
  open,
}: {
  record: RecordData;
  open: (id: string) => void;
}) {
  const story = explainDecision(record);
  return (
    <section className="reason-sheet" aria-label="Why this decision">
      <div className="section-overline">
        <Icon name="compass" size={16} />
        Inspection notes
      </div>
      <h2>Why this decision?</h2>
      <div className="reason-lines">
        {story.lines.map((l, i) => (
          <div key={i}>
            <span className="reason-bullet" aria-hidden="true" />
            <div>
              <h3>{l.label}</h3>
              <p>{l.text}</p>
              {l.sources.map((id, j) => (
                <button className="source-link" key={id} onClick={() => open(id)}>
                  <Icon name="image" size={14} />
                  {l.sources.length > 1 ? 'View photo ' + (j + 1) : 'View the photo'}
                  <Icon name="upRight" size={13} />
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
      {story.routes.length > 0 && (
        <details>
          <summary>What could move this forward?</summary>
          {story.routes.map((g, i) => (
            <p key={i}>
              {story.routes.length > 1 ? 'Option ' + (i + 1) + '. ' : ''}
              {g.join(' and ')}.
            </p>
          ))}
        </details>
      )}
      {record.receipt && (
        <details>
          <summary>Original inspection wording</summary>
          <p>
            <strong>{record.card.decisionTitle}</strong>
          </p>
          {record.reasons.filter(Boolean).map((s, i) => (
            <p key={i}>{s}</p>
          ))}
        </details>
      )}
      <p className="decision-limit">
        This is a trade-in decision. Photos cannot establish how well a garment will protect its
        rider.
      </p>
    </section>
  );
}
