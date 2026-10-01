<?php
/**
 * JSON-LD, document title and meta description for GardenProof posts.
 *
 * @package GardenProof
 */

defined( 'ABSPATH' ) || exit;

/**
 * JSON-LD is built by the GardenProof app (one source of truth, honest Review markup only when a real
 * rating exists) and printed here. Title/description are only set when no SEO plugin is active, so Yoast or
 * Rank Math stay in charge on sites that use them.
 */
class GardenProof_Seo {

	/**
	 * Hook up.
	 */
	public static function init() {
		add_action( 'wp_head', array( __CLASS__, 'print_head' ), 5 );
		add_filter( 'pre_get_document_title', array( __CLASS__, 'document_title' ), 20 );
	}

	/**
	 * Whether a dedicated SEO plugin manages titles and descriptions.
	 *
	 * @return bool
	 */
	private static function seo_plugin_active() {
		return defined( 'WPSEO_VERSION' ) || defined( 'RANK_MATH_VERSION' ) || defined( 'AIOSEO_VERSION' ) || class_exists( 'The_SEO_Framework\Load' );
	}

	/**
	 * Payload for the current singular GardenProof view.
	 *
	 * @return array|null
	 */
	private static function current() {
		return is_singular( array( 'gp_project', 'gp_article' ) ) ? GardenProof_Content::for_post() : null;
	}

	/**
	 * Use the SEO title written for the page.
	 *
	 * @param string $title Current title.
	 * @return string
	 */
	public static function document_title( $title ) {
		$content = self::current();
		if ( ! $content || self::seo_plugin_active() ) {
			return $title;
		}
		$seo_title = GardenProof_Content::get( $content, 'view.seoTitle' );
		return is_string( $seo_title ) && '' !== $seo_title ? $seo_title : $title;
	}

	/**
	 * Print JSON-LD (and the meta description when no SEO plugin does it).
	 */
	public static function print_head() {
		$content = self::current();
		if ( ! $content ) {
			return;
		}
		if ( ! self::seo_plugin_active() ) {
			$description = GardenProof_Content::get( $content, 'view.metaDescription' );
			if ( is_string( $description ) && '' !== $description ) {
				echo '<meta name="description" content="' . esc_attr( $description ) . '">' . "\n";
			}
		}
		$graph = GardenProof_Content::get( $content, 'jsonLd', null );
		if ( is_array( $graph ) && ! empty( $graph['@graph'] ) ) {
			// JSON_HEX_TAG escapes < and > so the payload cannot close the script element.
			echo '<script type="application/ld+json">' . wp_json_encode( $graph, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP ) . "</script>\n";
		}
	}
}
