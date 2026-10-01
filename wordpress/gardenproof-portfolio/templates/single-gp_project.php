<?php
/**
 * Single project (case study). Mirrors src/components/portfolio/PortfolioPage.tsx.
 * Override by copying to your theme as gardenproof/single-gp_project.php.
 *
 * @package GardenProof
 */

defined( 'ABSPATH' ) || exit;

get_header();

while ( have_posts() ) :
	the_post();
	$gp = GardenProof_Content::for_post();
	if ( ! $gp ) {
		// Not published by GardenProof (e.g. created by hand): fall back to the editor content.
		echo '<main class="gp gp-container gp-fallback">';
		the_title( '<h1 class="gp-h1">', '</h1>' );
		the_content();
		echo '</main>';
		continue;
	}
	$v        = $gp['view'];
	$settings = GardenProof_Settings::get();
	$cta_url  = $settings['cta_url'] ? $settings['cta_url'] : GardenProof_Content::get( $v, 'cta.url', home_url( '/contact/' ) );
	$cta_text = GardenProof_Content::get( $v, 'cta.text', __( 'Book a design consultation', 'gardenproof-portfolio' ) );
	$area     = GardenProof_Content::get( $v, 'facts.area' );
	$service  = GardenProof_Content::get( $v, 'facts.service' );
	$kicker   = implode( ' · ', array_filter( array( $service, $area ) ) );
	$review   = GardenProof_Content::get( $v, 'testimonial', null );
	$ba       = GardenProof_Content::get( $v, 'beforeAfter', null );
	$archive  = get_post_type_archive_link( 'gp_project' );
	?>
	<main class="gp gp-project" data-gp-project="<?php echo esc_attr( (string) GardenProof_Content::get( $v, 'slug' ) ); ?>">
		<article>
			<section class="gp-hero">
				<?php
				echo GardenProof_Content::image( GardenProof_Content::get( $v, 'hero', null ), 'gp-hero__img', array( 'loading' => 'eager', 'fetchpriority' => 'high', 'sizes' => '100vw' ) ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in helper.
				?>
				<div class="gp-hero__shade" aria-hidden="true"></div>
				<div class="gp-hero__text gp-container">
					<nav class="gp-breadcrumb" aria-label="<?php esc_attr_e( 'Breadcrumb', 'gardenproof-portfolio' ); ?>">
						<a href="<?php echo esc_url( home_url( '/' ) ); ?>"><?php esc_html_e( 'Home', 'gardenproof-portfolio' ); ?></a>
						<span aria-hidden="true">/</span>
						<a href="<?php echo esc_url( $archive ); ?>"><?php esc_html_e( 'Projects', 'gardenproof-portfolio' ); ?></a>
						<span aria-hidden="true">/</span>
						<span aria-current="page"><?php echo esc_html( $area ? $area : get_the_title() ); ?></span>
					</nav>
					<?php if ( $kicker ) : ?>
						<p class="gp-eyebrow gp-hero__kicker"><?php echo esc_html( $kicker ); ?></p>
					<?php endif; ?>
					<h1 class="gp-hero__title"><?php echo esc_html( GardenProof_Content::get( $v, 'h1', get_the_title() ) ); ?></h1>
				</div>
			</section>

			<section class="gp-container gp-intro">
				<div class="gp-intro__lede">
					<p class="gp-eyebrow"><?php esc_html_e( 'The project', 'gardenproof-portfolio' ); ?></p>
					<p class="gp-lede"><?php echo esc_html( GardenProof_Content::get( $v, 'summary' ) ); ?></p>
				</div>
				<aside class="gp-facts" aria-label="<?php esc_attr_e( 'Project facts', 'gardenproof-portfolio' ); ?>">
					<h2 class="gp-eyebrow"><?php esc_html_e( 'Project facts', 'gardenproof-portfolio' ); ?></h2>
					<dl>
						<?php
						$facts = array(
							__( 'Service', 'gardenproof-portfolio' )   => $service ? array( $service ) : array(),
							__( 'Area', 'gardenproof-portfolio' )      => $area ? array( $area ) : array(),
							__( 'Materials', 'gardenproof-portfolio' ) => GardenProof_Content::strings( $v, 'facts.materials' ),
							__( 'Features', 'gardenproof-portfolio' )  => GardenProof_Content::strings( $v, 'facts.features' ),
							__( 'Duration', 'gardenproof-portfolio' )  => GardenProof_Content::get( $v, 'facts.duration' ) ? array( GardenProof_Content::get( $v, 'facts.duration' ) ) : array(),
						);
						foreach ( $facts as $label => $values ) :
							if ( ! $values ) {
								continue;
							}
							?>
							<div class="gp-facts__row">
								<dt><?php echo esc_html( $label ); ?></dt>
								<dd>
									<?php foreach ( $values as $value ) : ?>
										<span><?php echo esc_html( $value ); ?></span>
									<?php endforeach; ?>
								</dd>
							</div>
						<?php endforeach; ?>
						<?php if ( is_array( $review ) && ! empty( $review['rating'] ) ) : ?>
							<div class="gp-facts__row">
								<dt><?php esc_html_e( 'Homeowner', 'gardenproof-portfolio' ); ?></dt>
								<dd class="gp-facts__rating"><?php echo GardenProof_Content::stars( $review['rating'] ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static markup, escaped label. ?> <?php echo esc_html( (int) $review['rating'] . '/5' ); ?></dd>
							</div>
						<?php endif; ?>
					</dl>
					<a class="gp-button gp-button--block" href="<?php echo esc_url( $cta_url ); ?>"><?php echo esc_html( $cta_text ); ?> <span aria-hidden="true">&rarr;</span></a>
				</aside>
			</section>

			<?php if ( is_array( $ba ) && ! empty( $ba['before'] ) && ! empty( $ba['after'] ) ) : ?>
				<?php GardenProof_Content::part( 'parts/before-after', array( 'ba' => $ba ) ); ?>
			<?php endif; ?>

			<section class="gp-container gp-story" aria-label="<?php esc_attr_e( 'The project story', 'gardenproof-portfolio' ); ?>">
				<ol>
					<?php
					$story = array(
						'brief'     => __( 'The brief', 'gardenproof-portfolio' ),
						'challenge' => __( 'The challenge', 'gardenproof-portfolio' ),
						'solution'  => __( 'Our solution', 'gardenproof-portfolio' ),
						'result'    => __( 'The result', 'gardenproof-portfolio' ),
					);
					$n     = 0;
					foreach ( $story as $key => $title ) :
						$text = GardenProof_Content::get( $v, 'sections.' . $key );
						if ( ! is_string( $text ) || '' === trim( $text ) ) {
							continue;
						}
						++$n;
						?>
						<li class="gp-story__item">
							<div class="gp-story__head">
								<span class="gp-story__num"><?php echo esc_html( str_pad( (string) $n, 2, '0', STR_PAD_LEFT ) ); ?></span>
								<h2><?php echo esc_html( $title ); ?></h2>
							</div>
							<p><?php echo esc_html( $text ); ?></p>
						</li>
					<?php endforeach; ?>
				</ol>
			</section>

			<?php if ( is_array( $review ) && ! empty( $review['quote'] ) ) : ?>
				<section class="gp-review" aria-label="<?php esc_attr_e( 'What the homeowner said', 'gardenproof-portfolio' ); ?>">
					<figure class="gp-container gp-review__inner">
						<?php echo GardenProof_Content::stars( isset( $review['rating'] ) ? $review['rating'] : 0 ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- static markup, escaped label. ?>
						<blockquote><p>&ldquo;<?php echo esc_html( $review['quote'] ); ?>&rdquo;</p></blockquote>
						<figcaption>
							<strong><?php echo esc_html( isset( $review['attribution'] ) ? $review['attribution'] : '' ); ?></strong>
							<span aria-hidden="true"> · </span>
							<?php
							/* translators: %d: star rating. */
							echo esc_html( sprintf( __( 'Homeowner, %d out of 5', 'gardenproof-portfolio' ), (int) $review['rating'] ) );
							?>
						</figcaption>
					</figure>
				</section>
			<?php endif; ?>

			<?php
			$gallery = GardenProof_Content::get( $v, 'gallery', array() );
			if ( is_array( $gallery ) && $gallery ) :
				?>
				<section class="gp-container gp-gallery" aria-labelledby="gp-gallery-title">
					<h2 id="gp-gallery-title" class="gp-eyebrow"><?php esc_html_e( 'Gallery', 'gardenproof-portfolio' ); ?></h2>
					<div class="gp-gallery__grid<?php echo 1 === count( $gallery ) % 2 ? ' gp-gallery__grid--odd' : ''; ?>">
						<?php foreach ( $gallery as $img ) : ?>
							<figure>
								<?php echo GardenProof_Content::image( $img, '', array( 'sizes' => '(min-width: 640px) 50vw, 100vw' ) ); // phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- escaped in helper. ?>
								<?php if ( ! empty( $img['caption'] ) ) : ?>
									<figcaption><?php echo esc_html( $img['caption'] ); ?></figcaption>
								<?php endif; ?>
							</figure>
						<?php endforeach; ?>
					</div>
				</section>
			<?php endif; ?>

			<?php GardenProof_Content::part( 'parts/faqs', array( 'faqs' => GardenProof_Content::get( $v, 'faqs', array() ) ) ); ?>

			<?php
			$links = GardenProof_Content::get( $v, 'internalLinks', array() );
			if ( is_array( $links ) && $links ) :
				?>
				<nav class="gp-container gp-more" aria-labelledby="gp-more-title">
					<h2 id="gp-more-title" class="gp-eyebrow"><?php esc_html_e( 'Keep exploring', 'gardenproof-portfolio' ); ?></h2>
					<ul>
						<?php foreach ( $links as $link ) : ?>
							<?php if ( ! empty( $link['url'] ) && ! empty( $link['text'] ) ) : ?>
								<li><a href="<?php echo esc_url( $link['url'] ); ?>"><?php echo esc_html( $link['text'] ); ?> <span aria-hidden="true">&rarr;</span></a></li>
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
				/* translators: %s: neighbourhood name. */
				'kicker'  => $area ? sprintf( __( 'A finished garden in %s', 'gardenproof-portfolio' ), $area ) : __( 'Real work, finished', 'gardenproof-portfolio' ),
				'heading' => __( 'Planning a garden like this one?', 'gardenproof-portfolio' ),
				'url'     => $cta_url,
				'text'    => $cta_text,
			)
		);
		?>
	</main>
	<?php
endwhile;

get_footer();
