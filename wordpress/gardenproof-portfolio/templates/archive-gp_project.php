<?php
/**
 * /projects/ archive (also service/area term archives). Mirrors src/app/(public)/portfolio/page.tsx.
 * Override by copying to your theme as gardenproof/archive-gp_project.php.
 *
 * @package GardenProof
 */

defined( 'ABSPATH' ) || exit;

get_header();

$gp_current = array(
	'gp_service' => sanitize_title( (string) get_query_var( 'gp_service' ) ),
	'gp_area'    => sanitize_title( (string) get_query_var( 'gp_area' ) ),
);
$gp_base    = get_post_type_archive_link( 'gp_project' );
?>
<main class="gp gp-archive">
	<header class="gp-container gp-archive__head">
		<p class="gp-eyebrow"><?php esc_html_e( 'Our work', 'gardenproof-portfolio' ); ?></p>
		<h1 class="gp-h1"><?php esc_html_e( 'Finished gardens, photographed as they are.', 'gardenproof-portfolio' ); ?></h1>
		<p class="gp-archive__intro"><?php esc_html_e( 'Every project here is a real garden we designed and built, with the materials used and, where they agreed to share it, what the homeowner said.', 'gardenproof-portfolio' ); ?></p>
	</header>
	<div class="gp-container gp-archive__filters">
		<?php
		echo GardenProof_Shortcode::filters( // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped when built.
			$gp_current,
			static function ( $taxonomy, $slug ) use ( $gp_current, $gp_base ) {
				$args              = array_filter( $gp_current );
				$args[ $taxonomy ] = $slug;
				return add_query_arg( array_filter( $args ), $gp_base );
			}
		);
		?>
	</div>
	<section class="gp-container gp-archive__grid" aria-label="<?php esc_attr_e( 'Projects', 'gardenproof-portfolio' ); ?>">
		<?php
		global $wp_query;
		echo GardenProof_Shortcode::cards( $wp_query ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped when built.
		the_posts_pagination();
		?>
	</section>
</main>
<?php
get_footer();
