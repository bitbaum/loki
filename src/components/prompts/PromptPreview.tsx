"use client";

import { ChevronDown } from "lucide-react";
import { promptBodyParts, variableLabel, type PromptVariable } from "@/lib/prompt-vars";

/**
 * The prompt's words, folded away until asked for ("See the prompt"). A blank
 * that has no value yet is drawn as a blank named in words — never as the raw
 * "{{project_name}}" the owner found in the sheet (2026-10-21) — and fills in
 * as soon as the project is picked.
 */
export function PromptPreview({ body, values }: { body: string; values: Record<string, string> }) {
  const parts = promptBodyParts(body, values);
  return (
    <details className="ui-prompt-preview">
      <summary className="ui-prompt-preview-summary">
        See the prompt
        <ChevronDown className="ui-prompt-preview-chevron" aria-hidden />
      </summary>
      <pre className="ui-prompt-preview-body">
        {parts.map((p, i) =>
          "text" in p ? (
            <span key={i}>{p.text}</span>
          ) : (
            <span key={i} className="ui-prompt-blank">
              {p.blank}
            </span>
          ),
        )}
      </pre>
    </details>
  );
}

/** One field per variable the prompt still needs, named in words. */
export function PromptVariableFields({
  idPrefix,
  variables,
  values,
  onChange,
}: {
  idPrefix: string;
  variables: PromptVariable[];
  values: Record<string, string>;
  onChange: (name: string, value: string) => void;
}) {
  if (variables.length === 0) return null;
  return (
    <div className="flex flex-col gap-4">
      {variables.map((v) => {
        const label = variableLabel(v.name);
        return (
          <div key={v.name}>
            <label className="ui-prompt-field-label" htmlFor={`${idPrefix}-${v.name}`}>
              {label.replace(/^./, (c) => c.toUpperCase())}
            </label>
            <input
              id={`${idPrefix}-${v.name}`}
              value={values[v.name] ?? ""}
              onChange={(e) => onChange(v.name, e.target.value)}
              placeholder={v.defaultValue ?? ""}
              className="ui-input"
            />
          </div>
        );
      })}
    </div>
  );
}
