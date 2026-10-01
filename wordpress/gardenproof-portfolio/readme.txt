=== GardenProof Portfolio ===
Contributors: gardenproof
Tags: portfolio, case study, landscaping, schema, lead tracking
Requires at least: 6.0
Tested up to: 6.8
Requires PHP: 7.4
Stable tag: 1.0.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Case-study project pages (/projects/), advice articles (/advice/), a filterable portfolio grid and lead
attribution for sites published by GardenProof.

== Description ==

GardenProof turns every finished garden job into a premium case-study page. The agency approves each page
in the GardenProof dashboard, and GardenProof publishes it here over the WordPress REST API.

* **Projects** (`gp_project`, archive at `/projects/`): full-bleed hero photo, before/after comparison
  slider (keyboard and touch accessible, two photos side by side without JavaScript), project facts,
  the brief / challenge / solution / result story, the homeowner's review (only when they consented and
  rated the job), gallery, FAQs and one clear call to action.
* **Advice articles** (`gp_article`, archive at `/advice/`).
* **Structured data**: Service, LocalBusiness reference, ImageObject, BreadcrumbList, FAQPage and — only
  when a real homeowner rating exists — Review. No AggregateRating is ever invented.
* **Shortcode** `[gardenproof_portfolio]` for a filterable project grid on any page.
* **Lead attribution**: a small first-party script records how a visitor arrived and which project they
  looked at, and attaches it to Contact Form 7 enquiries.

Each post stores its content in the `gp_content` meta (JSON written by GardenProof). The post body also
contains a plain HTML version, so nothing is lost if the plugin is switched off.

== Installation ==

1. In GardenProof, download `gardenproof-portfolio.zip` (or zip the `gardenproof-portfolio` folder).
2. WordPress admin → Plugins → Add New → Upload Plugin → choose the zip → Install → Activate.
   Activation registers `/projects/` and `/advice/`. If those URLs 404, visit Settings → Permalinks and
   press Save once.
3. Create a dedicated user for GardenProof: Users → Add New, username `gardenproof`, role **Editor**
   (Editors can publish posts and upload media; they cannot change plugins or settings).
4. Log in as that user (or edit it as an admin) → Profile → **Application Passwords** → name it
   "GardenProof" → Add New Application Password. Copy the password shown (it is displayed once).
   Application Passwords require HTTPS.
5. In the GardenProof app environment set:
   `WORDPRESS_BASE_URL=https://www.example.co.uk`, `WORDPRESS_USER=gardenproof`,
   `WORDPRESS_APP_PASSWORD=<the password from step 4>`.
6. Settings → GardenProof: enter the GardenProof app URL (e.g. `https://app.gardenproof.co.uk`) and the
   tenant slug (e.g. `thorburn`) to switch on lead tracking.
7. Optional: add `[gardenproof_portfolio]` to any page.

To revoke access at any time, delete the Application Password (Users → Profile).

== Shortcode ==

`[gardenproof_portfolio service="Patios & paving" area="Putney" limit="9" filters="yes"]`

* `service`, `area` — preset filters (name or slug). Visitors can change them with the filter chips.
* `limit` — number of projects (1–48, default 9).
* `filters` — `yes` (default) shows service/area chips; `no` hides them.

== Lead tracking ==

`gp-track.js` (about 3 KB, served by the GardenProof app) stores in the visitor's own browser
(localStorage / sessionStorage — no cookies, nothing sent until they submit a form):

* first touch and last touch: utm_source/medium/campaign/content/term, gclid, fbclid, landing page, referrer;
* the last project viewed (`/projects/<slug>/` or any element with `data-gp-project`).

It adds hidden `gp_*` fields to every Contact Form 7 form and to any `<form data-gp-lead>`, and when Contact
Form 7 reports the mail as sent (`wpcf7mailsent`) it posts the enquiry to GardenProof's lead log. To see the
values in CF7 emails too, add hidden tags to the form, e.g. `[hidden gp_utm_source] [hidden gp_project]`.

Mention the enquiry attribution in the site's privacy policy. Under PECR, storage that is strictly
necessary for a service the user requests is exempt; enquiry attribution is usually treated as analytics,
so check it against the site's consent approach.

== Theme overrides ==

Copy any file from `templates/` into your theme under `gardenproof/` (for example
`your-theme/gardenproof/single-gp_project.php` or `your-theme/gardenproof/parts/project-card.php`).
A theme's own `single-gp_project.php` / `archive-gp_project.php` is also respected. Brand colours are CSS
custom properties on `.gp` (`--gp-olive`, `--gp-olive-dark`, `--gp-display`, …).

== Frequently Asked Questions ==

= Does GardenProof ever publish without approval? =

No. Only assets approved by the agency in the GardenProof dashboard are sent to WordPress.

= Are street addresses published? =

Never. Pages name the neighbourhood only, and only with the homeowner's consent.

== Changelog ==

= 1.0.0 =
* First release: projects, advice articles, JSON-LD, before/after slider, portfolio shortcode, lead tracking.
