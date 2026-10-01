/** Serializable props the /f/<token> page hands to the client runner. */
import type { FormBrand } from "@/lib/forms/brand";
import type { Answers, FormDefinition } from "@/lib/forms/types";

export type FormView = {
  token: string;
  definition: FormDefinition;
  /** Saved answers (public). */
  answers: Answers;
  /** Prefilled starting values (not saved until confirmed). */
  initial: Answers;
  brand: FormBrand;
  /** Set when someone comes back to a half-finished form after a while. */
  resume: { answered: number; remaining: number; firstName: string | null } | null;
};

export type { FormBrand };

export const photoUrl = (token: string, id: string) => `/api/forms/${token}/photo/${id}`;
