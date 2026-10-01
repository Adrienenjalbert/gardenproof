/**
 * /preview/<assetId> — renders a portfolio page or article exactly as it will look on the tenant's site.
 * Published pages are public; drafts (and pages of a job whose homeowner withdrew consent) are shown only to
 * the signed-in operator and are a plain 404 for everyone else. Always noindex; drafts carry a banner.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ArticlePage } from "@/components/portfolio/ArticlePage";
import { PortfolioPage } from "@/components/portfolio/PortfolioPage";
import { viewerIsOperator } from "@/lib/publish/access";
import { loadPreview, type PreviewModel } from "@/lib/publish/data";

async function visibleModel(assetId: string): Promise<PreviewModel | null> {
  const model = await loadPreview(assetId);
  if (!model) return null;
  if (model.isPublic || (await viewerIsOperator())) return model;
  return null;
}

export async function generateMetadata(props: PageProps<"/preview/[assetId]">): Promise<Metadata> {
  const { assetId } = await props.params;
  const model = await visibleModel(assetId);
  if (!model) return { title: "Not found", robots: { index: false, follow: false } };
  const { view } = model;
  const image = view.kind === "portfolio_page" && view.hero ? [{ url: view.hero.src, alt: view.hero.alt }] : undefined;
  return {
    title: { absolute: view.seoTitle },
    description: view.metaDescription,
    robots: { index: false, follow: false },
    ...(model.isPublic ? { alternates: { canonical: view.canonicalUrl } } : {}),
    openGraph: { title: view.seoTitle, description: view.metaDescription, type: "article", images: image },
  };
}

export default async function PreviewPage(props: PageProps<"/preview/[assetId]">) {
  const { assetId } = await props.params;
  const model = await visibleModel(assetId);
  if (!model) notFound();
  const { asset, view } = model;
  const preview = model.isPublic ? undefined : { status: asset.status, version: asset.version };
  return view.kind === "portfolio_page" ? (
    <PortfolioPage view={view} preview={preview} />
  ) : (
    <ArticlePage view={view} preview={preview} />
  );
}
