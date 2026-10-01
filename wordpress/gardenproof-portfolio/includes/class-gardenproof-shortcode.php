<?php
/**
 * [gardenproof_portfolio] shortcode and the shared project grid renderer.
 *
 * @package GardenProof
 */

defined( 'ABSPATH' ) || exit;

/**
 * Usage: [gardenproof_portfolio service="Patios & paving" area="Putney" limit="9" filters="yes"]
 * - service / area preset the filter (term name or slug);
 * - filters="yes" shows service/area chips (links with ?gpf_service= / ?gpf_area=, no JavaScript needed).
 */
class GardenProof_Shortcode {

	/**
	 * Hook up.
	 */
	public static function init() {
		add_shortcode( 'gardenproof_portfolio', array( __CLASS__, 'render' ) );
	}

	/**
	 * Read a filter value from the query string. Read-only public filtering, so no nonce is involved.
	 *
	 * @param string $key Query arg.
	 * @return string Term slug or ''.
	 */
	public static function request_slug( $key ) {
		// phpcs:ignore WordPress.Security.NonceVerification.Recommended -- read-only public filter.
		return isset( $_GET[ $key ] ) ? sanitize_title( wp_unslash( $_GET[ $key ] ) ) : '';
	}

	/**
	 * Shortcode callback.
	 *
	 * @param array|string $atts Attributes.
	 * @return string
	 */
	public static function render( $atts ) {
		$atts = shortcode_atts(
			array(
				'service' => '',
				'area'    => '',
				'limit'   => 9,
				'filters' => 'yes',
			),
			$atts,
			'gardenproof_portfolio'
		);

		$current = array(
			'gp_service' => self::request_slug( 'gpf_service' ) ? self::request_slug( 'gpf_service' ) : sanitize_title( $atts['service'] ),
			'gp_area'    => self::request_slug( 'gpf_area' ) ? self::request_slug( 'gpf_area' ) : sanitize_title( $atts['area'] ),
		);
		$query   = new WP_Query( self::query_args( $current, max( 1, min( 48, (int) $atts['limit'] ) ) ) );

		$html = '<div class="gp gp-portfolio">';
		if ( 'yes' === $atts['filters'] ) {
			$html .= self::filters(
				$current,
				static function ( $taxonomy, $slug ) {
					$arg = 'gp_service' === $taxonomy ? 'gpf_service' : 'gpf_area';
					return $slug ? add_query_arg( $arg, $slug ) : remove_query_arg( $arg );
				}
			);
		}
		$html .= self::cards( $query );
		$html .= '</div>';
		wp_reset_postdata();
		return $html;
	}

	/**
	 * WP_Query args for published projects filtered by taxonomy slugs.
	 *
	 * @param array $current  Map of taxonomy => slug.
	 * @param int   $per_page Posts per page.
	 * @return array
	 */
	public static function query_args( $current, $per_page ) {
		$tax_query = array();
		foreach ( $current as $taxonomy => $slug ) {
			if ( $slug ) {
				$tax_query[] = array(
					'taxonomy' => $taxonomy,
					'field'    => 'slug',
					'terms'    => $slug,
				);
			}
		}
		$args = array(
			'post_type'      => 'gp_project',
			'post_status'    => 'publish',
			'posts_per_page' => $per_page,
			'no_found_rows'  => true,
		);
		if ( $tax_query ) {
			$args['tax_query'] = $tax_query; // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_tax_query -- small, indexed taxonomy filter.
		}
		return $args;
	}

	/**
	 * Filter chips for service and area.
	 *
	 * @param array    $current Map of taxonomy => current slug.
	 * @param callable $href    function( $taxonomy, $slug ) returning the URL for a chip.
	 * @return string HTML.
	 */
	public static function filters( $current, $href ) {
		$groups = array(
			'gp_service' => __( 'Service', 'gardenproof-portfolio' ),
			'gp_area'    => __( 'Area', 'gardenproof-portfolio' ),
		);
		$html   = '<div class="gp-filters">';
		foreach ( $groups as $taxonomy => $label ) {
			$terms = get_terms(
				array(
					'taxonomy'   => $taxonomy,
					'hide_empty' => true,
				)
			);
			if ( is_wp_error( $terms ) || count( $terms ) < 2 ) {
				continue;
			}
			$html .= '<div class="gp-filters__group"><p class="gp-eyebrow">' . esc_html( $label ) . '</p><ul>';
			$html .= self::chip( __( 'All', 'gardenproof-portfolio' ), call_user_func( $href, $taxonomy, '' ), '' === $current[ $taxonomy ] );
			foreach ( $terms as $term ) {
				$html .= self::chip( $term->name, call_user_func( $href, $taxonomy, $term->slug ), $current[ $taxonomy ] === $term->slug );
			}
			$html .= '</ul></div>';
		}
		return $html . '</div>';
	}

	/**
	 * One chip.
	 *
	 * @param string $label  Text.
	 * @param string $url    Link.
	 * @param bool   $active Selected.
	 * @return string HTML.
	 */
	private static function chip( $label, $url, $active ) {
		return sprintf(
			'<li><a class="gp-chip%s" href="%s"%s>%s</a></li>',
			$active ? ' is-active' : '',
			esc_url( $url ),
			$active ? ' aria-current="true"' : '',
			esc_html( $label )
		);
	}

	/**
	 * Card grid for a query.
	 *
	 * @param WP_Query $query Projects.
	 * @return string HTML.
	 */
	public static function cards( $query ) {
		if ( ! $query->have_posts() ) {
			return '<p class="gp-empty">' . esc_html__( 'No projects match these filters yet.', 'gardenproof-portfolio' ) . '</p>';
		}
		ob_start();
		echo '<ul class="gp-grid">';
		while ( $query->have_posts() ) {
			$query->the_post();
			GardenProof_Content::part( 'parts/project-card', array( 'post' => get_post() ) );
		}
		echo '</ul>';
		return (string) ob_get_clean();
	}
}
