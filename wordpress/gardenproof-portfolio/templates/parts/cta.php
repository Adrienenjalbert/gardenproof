<?php
/**
 * Closing call to action: one clear action.
 *
 * @package GardenProof
 *
 * @var array $args { kicker, heading, url, text, body? }
 */

defined( 'ABSPATH' ) || exit;
?>
<section class="gp-cta" aria-labelledby="gp-cta-title">
	<div class="gp-container gp-cta__inner">
		<div>
			<p class="gp-eyebrow"><?php echo esc_html( $args['kicker'] ); ?></p>
			<h2 id="gp-cta-title"><?php echo esc_html( $args['heading'] ); ?></h2>
			<p><?php echo esc_html( isset( $args['body'] ) ? $args['body'] : __( 'Talk it through with the team who designed and built it.', 'gardenproof-portfolio' ) ); ?></p>
		</div>
		<a class="gp-button gp-button--large" href="<?php echo esc_url( $args['url'] ); ?>"><?php echo esc_html( $args['text'] ); ?> <span aria-hidden="true">&rarr;</span></a>
	</div>
</section>
