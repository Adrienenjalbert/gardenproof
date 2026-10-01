<?php
/**
 * Project card for the archive and the [gardenproof_portfolio] grid.
 *
 * @package GardenProof
 *
 * @var array $args { post: WP_Post }
 */

defined( 'ABSPATH' ) || exit;

$gp_post    = $args['post'];
$gp_content = GardenProof_Content::for_post( $gp_post );
$gp_view    = $gp_content ? $gp_content['view'] : array();
$gp_kicker  = implode( ' · ', array_filter( array( GardenProof_Content::get( $gp_view, 'facts.service' ), GardenProof_Content::get( $gp_view, 'facts.area' ) ) ) );
$gp_hero    = GardenProof_Content::get( $gp_view, 'hero', null );
?>
<li class="gp-card">
	<a href="<?php echo esc_url( get_permalink( $gp_post ) ); ?>">
		<div class="gp-card__media">
			<?php
			if ( $gp_hero ) {
				echo GardenProof_Content::image( $gp_hero, '', array( 'sizes' => '(min-width: 1024px) 33vw, (min-width: 640px) 50vw, 100vw' ) ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in helper.
			} elseif ( has_post_thumbnail( $gp_post ) ) {
				echo get_the_post_thumbnail( $gp_post, 'large' );
			}
			?>
		</div>
		<?php if ( $gp_kicker ) : ?>
			<p class="gp-eyebrow"><?php echo esc_html( $gp_kicker ); ?></p>
		<?php endif; ?>
		<h2 class="gp-card__title"><?php echo esc_html( get_the_title( $gp_post ) ); ?></h2>
	</a>
</li>
