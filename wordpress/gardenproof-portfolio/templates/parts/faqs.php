<?php
/**
 * FAQ list (details/summary: accessible and works without JavaScript).
 *
 * @package GardenProof
 *
 * @var array $args { faqs: [{ q, a }], title?: string }
 */

defined( 'ABSPATH' ) || exit;

$gp_faqs = isset( $args['faqs'] ) && is_array( $args['faqs'] ) ? $args['faqs'] : array();
if ( ! $gp_faqs ) {
	return;
}
$gp_title = isset( $args['title'] ) ? $args['title'] : __( 'Questions about this project', 'gardenproof-portfolio' );
?>
<section class="gp-container gp-faqs" aria-labelledby="gp-faq-title">
	<h2 id="gp-faq-title"><?php echo esc_html( $gp_title ); ?></h2>
	<div class="gp-faqs__list">
		<?php foreach ( $gp_faqs as $gp_faq ) : ?>
			<?php
			if ( empty( $gp_faq['q'] ) || empty( $gp_faq['a'] ) ) {
				continue;
			}
			?>
			<details>
				<summary><?php echo esc_html( $gp_faq['q'] ); ?><span aria-hidden="true">+</span></summary>
				<p><?php echo esc_html( $gp_faq['a'] ); ?></p>
			</details>
		<?php endforeach; ?>
	</div>
</section>
