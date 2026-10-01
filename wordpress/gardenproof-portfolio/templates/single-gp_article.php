<?php
/**
 * Single advice article. Mirrors src/components/portfolio/ArticlePage.tsx.
 * Override by copying to your theme as gardenproof/single-gp_article.php.
 *
 * @package GardenProof
 */

defined( 'ABSPATH' ) || exit;

get_header();

while ( have_posts() ) :
	the_post();
	$gp       = GardenProof_Content::for_post();
	$v        = $gp ? $gp['view'] : array();
	$settings = GardenProof_Settings::get();
	$cta_url  = $settings['cta_url'] ? $settings['cta_url'] : GardenProof_Content::get( $v, 'cta.url', home_url( '/contact/' ) );
	?>
	<main class="gp gp-article">
		<article>
			<header class="gp-article__head">
				<div class="gp-container gp-container--narrow">
					<p class="gp-eyebrow"><?php esc_html_e( 'Garden advice', 'gardenproof-portfolio' ); ?></p>
					<h1 class="gp-h1"><?php the_title(); ?></h1>
					<?php if ( GardenProof_Content::get( $v, 'metaDescription' ) ) : ?>
						<p class="gp-article__dek"><?php echo esc_html( GardenProof_Content::get( $v, 'metaDescription' ) ); ?></p>
					<?php endif; ?>
				</div>
			</header>
			<div class="gp-container gp-container--narrow gp-prose">
				<?php
				if ( $gp ) {
					// Rendered by GardenProof's escaping markdown renderer; kses again as defence in depth.
					echo wp_kses_post( (string) GardenProof_Content::get( $v, 'bodyHtml' ) );
				} else {
					the_content();
				}
				?>
			</div>
			<?php
			if ( $gp ) {
				GardenProof_Content::part(
					'parts/faqs',
					array(
						'faqs'  => GardenProof_Content::get( $v, 'faqs', array() ),
						'title' => __( 'Common questions', 'gardenproof-portfolio' ),
					)
				);
			}
			$related = GardenProof_Content::get( $v, 'relatedProjects', array() );
			if ( is_array( $related ) && $related ) :
				?>
				<nav class="gp-container gp-more" aria-labelledby="gp-more-title">
					<h2 id="gp-more-title" class="gp-eyebrow"><?php esc_html_e( 'Related projects', 'gardenproof-portfolio' ); ?></h2>
					<ul>
						<?php foreach ( $related as $link ) : ?>
							<?php if ( ! empty( $link['url'] ) && ! empty( $link['title'] ) ) : ?>
								<li><a href="<?php echo esc_url( $link['url'] ); ?>"><?php echo esc_html( $link['title'] ); ?> <span aria-hidden="true">&rarr;</span></a></li>
							<?php endif; ?>
						<?php endforeach; ?>
					</ul>
				</nav>
			<?php endif; ?>
		</article>
		<?php
		GardenProof_Content::part(
			'parts/cta',
			array(
				'kicker'  => __( 'Real work, finished', 'gardenproof-portfolio' ),
				'heading' => __( 'Thinking about your own garden?', 'gardenproof-portfolio' ),
				'body'    => __( 'Talk it through with the team who builds these gardens.', 'gardenproof-portfolio' ),
				'url'     => $cta_url,
				'text'    => GardenProof_Content::get( $v, 'cta.text', __( 'Book a design consultation', 'gardenproof-portfolio' ) ),
			)
		);
		?>
	</main>
	<?php
endwhile;

get_footer();
