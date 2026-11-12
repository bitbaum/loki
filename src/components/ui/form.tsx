export function Field({
  label,
  required = false,
  aiTouched = false,
  hint,
  htmlFor,
  children,
}: {
  label: string;
  required?: boolean;
  /** Marks a field the assistant wrote, so an AI edit is never silent. */
  aiTouched?: boolean;
  /** One plain line under the field — what it is for, so the label stays a label. */
  hint?: string;
  /** The id of the control inside, so the label names it (and a press on the
   *  label focuses it). */
  htmlFor?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label htmlFor={htmlFor} className="ui-kicker mb-1.5 block">
        {label}
        {required && <span className="text-status-negative"> *</span>}
        {aiTouched && <span className="ui-assist-flag">AI</span>}
      </label>
      {children}
      {hint && <p className="ui-field-hint">{hint}</p>}
    </div>
  );
}
