/**
 * /f/<token> — a smart form (enquiry, project brief, maintenance visit). The link is the save file: open it on
 * any device and it resumes where it was left. Finished forms show the confirmation.
 */
import type { Metadata } from "next";
import { Confirmation } from "@/components/forms/confirmation";
import { FormFrame } from "@/components/forms/frame";
import { FormRunner } from "@/components/forms/form-runner";
import { FormStyles } from "@/components/forms/styles";
import type { FormView } from "@/components/forms/view";
import { getForm, initialValues } from "@/lib/forms";
import { summarise, visibleSteps } from "@/lib/forms/engine";
import type { ContactValue } from "@/lib/forms/types";

export const dynamic = "force-dynamic";

/** How long since the last answer (request-time; the page is dynamic). */
function idleMs(since: Date): number {
  return Date.now() - since.getTime();
}

/** Coming back after this long shows the "Welcome back" screen instead of dropping straight into a question. */
const RESUME_AFTER_MS = 20 * 60_000;

export async function generateMetadata({ params }: PageProps<"/f/[token]">): Promise<Metadata> {
  const form = await getForm((await params).token);
  return {
    title: form ? { absolute: `${form.definition.intro.title} · ${form.brand.name}` } : "Link not found",
    robots: { index: false, follow: false },
  };
}

function NotFound() {
  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-[#fbfaf7] px-8 text-center">
      <FormStyles />
      <h1 className="font-display text-2xl text-[#16180f]">This link doesn&apos;t look quite right</h1>
      <p className="mt-3 max-w-xs text-[15px] leading-relaxed text-black/55">Please check you&apos;ve opened the full link from our message.</p>
    </main>
  );
}

export default async function FormPage({ params, searchParams }: PageProps<"/f/[token]">) {
  const { token } = await params;
  // Reminder links carry ?welcome so they open on "Welcome back" rather than mid-question.
  const welcome = "welcome" in (await searchParams);
  const form = await getForm(token);
  if (!form) return <NotFound />;

  const firstName = (form.answers.contact as ContactValue | undefined)?.firstName ?? form.meta.prefill?.firstName ?? null;

  if (form.completed) {
    return (
      <FormFrame brand={form.brand}>
        <Confirmation
          brand={form.brand}
          kind={form.kind}
          firstName={firstName}
          summary={summarise(form.definition, form.answers)}
          happy={form.kind === "maintenance_visit" ? !form.meta.result?.urgent : undefined}
        />
      </FormFrame>
    );
  }

  const answered = visibleSteps(form.definition, form.answers).length - form.remaining;
  const away = welcome || idleMs(form.row.updatedAt) > RESUME_AFTER_MS;
  const view: FormView = {
    token,
    definition: form.definition,
    answers: form.answers,
    initial: initialValues(form),
    brand: form.brand,
    resume: answered > 0 && form.remaining > 0 && away ? { answered, remaining: form.remaining, firstName } : null,
  };
  return (
    <FormFrame brand={form.brand}>
      <FormRunner view={view} />
    </FormFrame>
  );
}
