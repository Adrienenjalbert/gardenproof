<?php
/**
 * Before/after comparison. Without JavaScript: two photos side by side. assets/before-after.js turns it
 * into a draggable, keyboard-accessible slider (same behaviour as the Next preview).
 *
 * @package GardenProof
 *
 * @var array $args { ba: { before: image, after: image } }
 */

defined( 'ABSPATH' ) || exit;

$gp_ba    = $args['ba'];
$gp_after = $gp_ba['after'];
$gp_w     = ! empty( $gp_after['width'] ) ? (int) $gp_after['width'] : 3;
$gp_h     = ! empty( $gp_after['height'] ) ? (int) $gp_after['height'] : 2;
// Never taller than 5:4 so square/portrait phone shots don't fill the whole screen.
$gp_ratio = ( $gp_w / max( 1, $gp_h ) ) < 1.25 ? '5 / 4' : $gp_w . ' / ' . $gp_h;
// Never stretch small phone stills beyond their own pixels: cap the box at the narrower photo's width.
$gp_widths = array_filter(
	array(
		isset( $gp_ba['before']['width'] ) ? (int) $gp_ba['before']['width'] : 0,
		isset( $gp_after['width'] ) ? (int) $gp_after['width'] : 0,
	)
);
$gp_style  = 'aspect-ratio: ' . $gp_ratio . ( $gp_widths ? '; max-width: ' . min( $gp_widths ) . 'px' : '' );
?>
<section class="gp-container gp-ba-section" aria-labelledby="gp-ba-title">
	<div class="gp-ba-section__head">
		<h2 id="gp-ba-title"><?php esc_html_e( 'Before & after', 'gardenproof-portfolio' ); ?></h2>
		<p><?php esc_html_e( 'Drag across the photo, or use the arrow keys, to compare.', 'gardenproof-portfolio' ); ?></p>
	</div>
	<div class="gp-ba" style="<?php echo esc_attr( $gp_style ); ?>" data-gp-ba data-label="<?php esc_attr_e( 'Compare before and after photos', 'gardenproof-portfolio' ); ?>">
		<figure class="gp-ba__before">
			<?php echo GardenProof_Content::image( $gp_ba['before'], '', array( 'draggable' => 'false' ) ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in helper. ?>
			<span class="gp-ba__label gp-ba__label--left"><?php esc_html_e( 'Before', 'gardenproof-portfolio' ); ?></span>
		</figure>
		<figure class="gp-ba__after">
			<?php echo GardenProof_Content::image( $gp_after, '', array( 'draggable' => 'false' ) ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in helper. ?>
			<span class="gp-ba__label gp-ba__label--right"><?php esc_html_e( 'After', 'gardenproof-portfolio' ); ?></span>
		</figure>
	</div>
</section>
