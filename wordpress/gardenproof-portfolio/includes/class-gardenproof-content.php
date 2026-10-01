<?php
/**
 * Reading and rendering helpers for the gp_content payload.
 *
 * @package GardenProof
 */

defined( 'ABSPATH' ) || exit;

/**
 * The GardenProof app writes one JSON document per post (see src/lib/publish/wp-mappers.ts):
 * { version, type: "portfolio_page"|"seo_article", view: {...render model...}, jsonLd: {...} }.
 * Every value is treated as untrusted text and escaped at output.
 */
class GardenProof_Content {

	/**
	 * Decode a raw meta value.
	 *
	 * @param mixed $raw Meta value.
	 * @return array|null
	 */
	public static function decode( $raw ) {
		if ( ! is_string( $raw ) || '' === $raw ) {
			return null;
		}
		$data = json_decode( $raw, true );
		return ( is_array( $data ) && isset( $data['view'] ) && is_array( $data['view'] ) ) ? $data : null;
	}

	/**
	 * Payload for a post, or null when the post was not published by GardenProof.
	 *
	 * @param int|WP_Post|null $post Post.
	 * @return array|null
	 */
	public static function for_post( $post = null ) {
		$post = get_post( $post );
		if ( ! $post ) {
			return null;
		}
		return self::decode( get_post_meta( $post->ID, GardenProof_Post_Types::META_KEY, true ) );
	}

	/**
	 * Safe string lookup with a dotted path, e.g. get( $view, 'facts.area' ).
	 *
	 * @param array  $data    Source array.
	 * @param string $path    Dotted path.
	 * @param mixed  $default Fallback.
	 * @return mixed
	 */
	public static function get( $data, $path, $default = '' ) {
		foreach ( explode( '.', $path ) as $key ) {
			if ( ! is_array( $data ) || ! array_key_exists( $key, $data ) || null === $data[ $key ] ) {
				return $default;
			}
			$data = $data[ $key ];
		}
		return $data;
	}

	/**
	 * List of strings from the payload (non-strings dropped).
	 *
	 * @param array  $data Source array.
	 * @param string $path Dotted path.
	 * @return string[]
	 */
	public static function strings( $data, $path ) {
		$list = self::get( $data, $path, array() );
		return is_array( $list ) ? array_values( array_filter( $list, 'is_string' ) ) : array();
	}

	/**
	 * Render an image from the payload: the WordPress attachment (with srcset) when we have one,
	 * otherwise the absolute URL served by the GardenProof app.
	 *
	 * @param array|null $img   Image entry { src, alt, width, height, wpId }.
	 * @param string     $class CSS class.
	 * @param array      $attrs Extra attributes (loading, fetchpriority, sizes).
	 * @return string HTML.
	 */
	public static function image( $img, $class = '', $attrs = array() ) {
		if ( ! is_array( $img ) || empty( $img['src'] ) ) {
			return '';
		}
		$alt   = isset( $img['alt'] ) ? (string) $img['alt'] : '';
		$attrs = array_merge(
			array(
				'loading'  => 'lazy',
				'decoding' => 'async',
			),
			$attrs
		);
		// Never display a photo wider than its own pixels (upscaled phone stills look soft).
		if ( ! empty( $img['width'] ) && ! isset( $attrs['style'] ) ) {
			$attrs['style'] = 'max-width: ' . (int) $img['width'] . 'px';
		}
		if ( ! empty( $img['wpId'] ) && wp_attachment_is_image( (int) $img['wpId'] ) ) {
			return wp_get_attachment_image(
				(int) $img['wpId'],
				'full',
				false,
				array_merge(
					$attrs,
					array(
						'class' => $class,
						'alt'   => $alt,
					)
				)
			);
		}
		$html = sprintf( '<img src="%s" alt="%s" class="%s"', esc_url( $img['src'] ), esc_attr( $alt ), esc_attr( $class ) );
		if ( ! empty( $img['width'] ) && ! empty( $img['height'] ) ) {
			$html .= sprintf( ' width="%d" height="%d"', (int) $img['width'], (int) $img['height'] );
		}
		foreach ( $attrs as $name => $value ) {
			$html .= sprintf( ' %s="%s"', esc_attr( $name ), esc_attr( $value ) );
		}
		return $html . '>';
	}

	/**
	 * Five-star rating markup with an accessible label.
	 *
	 * @param int $rating 1..5.
	 * @return string HTML.
	 */
	public static function stars( $rating ) {
		$rating = max( 0, min( 5, (int) $rating ) );
		/* translators: %d: star rating out of 5. */
		$html = '<span class="gp-stars" role="img" aria-label="' . esc_attr( sprintf( __( 'Rated %d out of 5', 'gardenproof-portfolio' ), $rating ) ) . '">';
		for ( $i = 0; $i < 5; $i++ ) {
			$html .= '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 1.8l2.47 5.2 5.68.66-4.2 3.9 1.12 5.62L10 14.4l-5.07 2.78 1.12-5.62-4.2-3.9 5.68-.66z" fill="' . ( $i < $rating ? 'currentColor' : 'none' ) . '" stroke="currentColor" stroke-width="1.2"/></svg>';
		}
		return $html . '</span>';
	}

	/**
	 * Load a template part, letting themes override it from /gardenproof/<name>.php.
	 *
	 * @param string $name Part name, e.g. "parts/project-card".
	 * @param array  $args Variables for the part.
	 */
	public static function part( $name, $args = array() ) {
		$theme = locate_template( array( 'gardenproof/' . $name . '.php' ) );
		$file  = $theme ? $theme : GARDENPROOF_DIR . 'templates/' . $name . '.php';
		if ( file_exists( $file ) ) {
			load_template( $file, false, $args );
		}
	}
}
