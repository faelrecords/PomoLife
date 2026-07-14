import type {
  FieldDefinition,
  FormValues,
  PromptDefinition,
  ValidationErrors,
} from "./types";

const REQUIRED_MESSAGE = "Preencha este campo para continuar.";

export function normalizeFormValue(value: string | undefined): string {
  return (value ?? "").replace(/\r\n?/g, "\n").trim();
}

export function validateFields(
  fields: readonly FieldDefinition[],
  values: FormValues,
): ValidationErrors {
  const errors: ValidationErrors = {};

  for (const field of fields) {
    const value = normalizeFormValue(values[field.name]);

    if (field.required && value.length === 0) {
      errors[field.name] = REQUIRED_MESSAGE;
      continue;
    }

    if (value.length === 0) {
      continue;
    }

    if (field.maxLength !== undefined && value.length > field.maxLength) {
      errors[field.name] = `Use no máximo ${field.maxLength.toLocaleString("pt-BR")} caracteres.`;
      continue;
    }

    if (field.type === "number") {
      const numericValue = Number(value);

      if (!Number.isFinite(numericValue)) {
        errors[field.name] = "Informe um número válido.";
        continue;
      }

      if (field.min !== undefined && numericValue < field.min) {
        errors[field.name] = `Informe um valor de pelo menos ${field.min}.`;
        continue;
      }

      if (field.max !== undefined && numericValue > field.max) {
        errors[field.name] = `Informe um valor de no máximo ${field.max}.`;
      }
    }

    if (
      field.type === "select" &&
      field.options !== undefined &&
      !field.options.some((option) => option.value === value)
    ) {
      errors[field.name] = "Escolha uma das opções disponíveis.";
    }
  }

  return errors;
}

export function validatePrompt(
  definition: PromptDefinition,
  values: FormValues,
): ValidationErrors {
  return definition.validate(values);
}

export function hasValidationErrors(errors: ValidationErrors): boolean {
  return Object.keys(errors).length > 0;
}

export function createInitialValues(
  definition: Pick<PromptDefinition, "fields">,
): FormValues {
  return Object.fromEntries(
    definition.fields.map((field) => [field.name, field.initialValue ?? ""]),
  );
}
