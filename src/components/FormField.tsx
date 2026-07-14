import type { ChangeEvent } from "react";
import type { FieldDefinition, FormValues, ValidationErrors } from "../domain";

interface FormFieldProps {
  field: FieldDefinition;
  values: FormValues;
  errors: ValidationErrors;
  onChange: (name: string, value: string) => void;
}

export function FormField({ field, values, errors, onChange }: FormFieldProps) {
  const value = values[field.name] ?? "";
  const error = errors[field.name];
  const inputId = `field-${field.name}`;
  const describedBy = [field.helperText ? `${inputId}-help` : "", error ? `${inputId}-error` : ""]
    .filter(Boolean)
    .join(" ") || undefined;
  const sharedProps = {
    id: inputId,
    name: field.name,
    value,
    required: field.required,
    "aria-invalid": Boolean(error),
    "aria-describedby": describedBy,
    onChange: (event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
      onChange(field.name, event.target.value),
  };

  return (
    <div className={`form-field ${error ? "has-error" : ""}`}>
      <label htmlFor={inputId}>
        {field.label}
        {field.required && <span aria-hidden="true">*</span>}
      </label>

      {field.type === "textarea" ? (
        <textarea
          {...sharedProps}
          rows={field.rows ?? 3}
          maxLength={field.maxLength}
          placeholder={field.placeholder}
          data-autofocus={field.name === "task" || field.name === "target" || field.name === "previousTask" || field.name === "project" || field.name === "brainDump" ? true : undefined}
        />
      ) : field.type === "select" ? (
        <select {...sharedProps}>
          {field.options?.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          {...sharedProps}
          type={field.type}
          min={field.min}
          max={field.max}
          step={field.step}
          maxLength={field.maxLength}
          placeholder={field.placeholder}
          data-autofocus={field.name === "task" || field.name === "target" || field.name === "previousTask" || field.name === "project" ? true : undefined}
        />
      )}

      <div className="field-support">
        <span id={`${inputId}-help`} className="field-hint">
          {field.helperText ?? ""}
        </span>
        {field.maxLength && field.type !== "number" && (
          <span className="character-count" aria-label={`${value.length} de ${field.maxLength} caracteres`}>
            {value.length}/{field.maxLength}
          </span>
        )}
      </div>
      {error && (
        <p id={`${inputId}-error`} className="field-error" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
