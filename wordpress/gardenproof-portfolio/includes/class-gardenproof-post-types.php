<?php
/**
 * Custom post types, taxonomies and the gp_content meta.
 *
 * @package GardenProof
 */

defined( 'ABSPATH' ) || exit;

/**
 * Registers gp_project (/projects/) and gp_article (/advice/), the gp_service / gp_area taxonomies used by
 * the filters, and the gp_content JSON meta written by the GardenProof app over the REST API.
 */
class GardenProof_Post_Types {

	const META_KEY = 'gp_content';

	/**
	 * Hook everything up.
	 */
	public static function init() {
		add_action( 'init', array( __CLASS__, 'register' ) );
		add_action( 'added_post_meta', array( __CLASS__, 'sync_terms_from_meta' ), 10, 4 );
		add_action( 'updated_post_meta', array( __CLASS__, 'sync_terms_from_meta' ), 10, 4 );
		add_filter( 'rest_prepare_gp_project', array( __CLASS__, 'scrub_rest_meta' ), 10, 1 );
		add_filter( 'rest_prepare_gp_article', array( __CLASS__, 'scrub_rest_meta' ), 10, 1 );
	}

	/**
	 * Remove internal storage keys from image objects. The app no longer sends them, but payloads saved by
	 * older versions did, and the meta is readable over the public REST API.
	 *
	 * @param array $view Decoded view.
	 * @return array
	 */
	public static function strip_storage_keys( $view ) {
		$strip = static function ( $img ) {
			if ( is_array( $img ) ) {
				unset( $img['key'] );
			}
			return $img;
		};
		if ( isset( $view['hero'] ) ) {
			$view['hero'] = $strip( $view['hero'] );
		}
		if ( isset( $view['beforeAfter'] ) && is_array( $view['beforeAfter'] ) ) {
			foreach ( array( 'before', 'after' ) as $side ) {
				if ( isset( $view['beforeAfter'][ $side ] ) ) {
					$view['beforeAfter'][ $side ] = $strip( $view['beforeAfter'][ $side ] );
				}
			}
		}
		if ( isset( $view['gallery'] ) && is_array( $view['gallery'] ) ) {
			$view['gallery'] = array_map( $strip, $view['gallery'] );
		}
		return $view;
	}

	/**
	 * Scrub legacy storage keys from gp_content in REST responses.
	 *
	 * @param WP_REST_Response $response Response.
	 * @return WP_REST_Response
	 */
	public static function scrub_rest_meta( $response ) {
		$data = $response->get_data();
		if ( empty( $data['meta'][ self::META_KEY ] ) || ! is_string( $data['meta'][ self::META_KEY ] ) ) {
			return $response;
		}
		$decoded = json_decode( $data['meta'][ self::META_KEY ], true );
		if ( is_array( $decoded ) && isset( $decoded['view'] ) && is_array( $decoded['view'] ) ) {
			$decoded['view']                = self::strip_storage_keys( $decoded['view'] );
			$data['meta'][ self::META_KEY ] = wp_json_encode( $decoded );
			$response->set_data( $data );
		}
		return $response;
	}

	/**
	 * Register post types, taxonomies and meta.
	 */
	public static function register() {
		register_post_type(
			'gp_project',
			array(
				'labels'       => array(
					'name'          => __( 'Projects', 'gardenproof-portfolio' ),
					'singular_name' => __( 'Project', 'gardenproof-portfolio' ),
					'add_new_item'  => __( 'Add project', 'gardenproof-portfolio' ),
					'edit_item'     => __( 'Edit project', 'gardenproof-portfolio' ),
					'all_items'     => __( 'All projects', 'gardenproof-portfolio' ),
				),
				'public'       => true,
				'has_archive'  => 'projects',
				'rewrite'      => array(
					'slug'       => 'projects',
					'with_front' => false,
				),
				'menu_icon'    => 'dashicons-palmtree',
				'show_in_rest' => true,
				'rest_base'    => 'gp_project',
				// custom-fields is required for the meta to be exposed over REST.
				'supports'     => array( 'title', 'editor', 'excerpt', 'thumbnail', 'custom-fields', 'revisions' ),
			)
		);

		register_post_type(
			'gp_article',
			array(
				'labels'       => array(
					'name'          => __( 'Advice', 'gardenproof-portfolio' ),
					'singular_name' => __( 'Advice article', 'gardenproof-portfolio' ),
					'add_new_item'  => __( 'Add article', 'gardenproof-portfolio' ),
					'edit_item'     => __( 'Edit article', 'gardenproof-portfolio' ),
				),
				'public'       => true,
				'has_archive'  => 'advice',
				'rewrite'      => array(
					'slug'       => 'advice',
					'with_front' => false,
				),
				'menu_icon'    => 'dashicons-welcome-write-blog',
				'show_in_rest' => true,
				'rest_base'    => 'gp_article',
				'supports'     => array( 'title', 'editor', 'excerpt', 'custom-fields', 'revisions' ),
			)
		);

		$taxonomies = array(
			'gp_service' => array( __( 'Services', 'gardenproof-portfolio' ), __( 'Service', 'gardenproof-portfolio' ), 'service' ),
			'gp_area'    => array( __( 'Areas', 'gardenproof-portfolio' ), __( 'Area', 'gardenproof-portfolio' ), 'area' ),
		);
		foreach ( $taxonomies as $taxonomy => $labels ) {
			register_taxonomy(
				$taxonomy,
				'gp_project',
				array(
					'labels'            => array(
						'name'          => $labels[0],
						'singular_name' => $labels[1],
					),
					'public'            => true,
					'hierarchical'      => false,
					'show_in_rest'      => true,
					'show_admin_column' => true,
					'query_var'         => $taxonomy,
					'rewrite'           => array( 'slug' => 'projects/' . $labels[2] ),
				)
			);
		}

		foreach ( array( 'gp_project', 'gp_article' ) as $post_type ) {
			register_post_meta(
				$post_type,
				self::META_KEY,
				array(
					'type'              => 'string',
					'description'       => __( 'Structured page content (JSON) published by GardenProof.', 'gardenproof-portfolio' ),
					'single'            => true,
					'show_in_rest'      => true,
					'sanitize_callback' => array( __CLASS__, 'sanitize_content_meta' ),
					'auth_callback'     => array( __CLASS__, 'can_edit_meta' ),
				)
			);
		}
	}

	/**
	 * Only editors (the dedicated GardenProof user has the Editor role) may write the structured content.
	 *
	 * @return bool
	 */
	public static function can_edit_meta() {
		return current_user_can( 'edit_posts' );
	}

	/**
	 * Accept only well-formed GardenProof payloads; anything else is stored as an empty string.
	 * Values are escaped at output time in the templates, never trusted as HTML.
	 *
	 * @param mixed $value Raw meta value.
	 * @return string
	 */
	public static function sanitize_content_meta( $value ) {
		if ( ! is_string( $value ) || '' === $value ) {
			return '';
		}
		$decoded = json_decode( $value, true );
		if ( ! is_array( $decoded ) || empty( $decoded['type'] ) || empty( $decoded['view'] ) || ! is_array( $decoded['view'] ) ) {
			return '';
		}
		if ( ! in_array( $decoded['type'], array( 'portfolio_page', 'seo_article' ), true ) ) {
			return '';
		}
		$decoded['view'] = self::strip_storage_keys( $decoded['view'] );
		$encoded         = wp_json_encode( $decoded );
		return false === $encoded ? '' : $encoded;
	}

	/**
	 * Keep the service / area taxonomies in step with the structured content so filters use native queries.
	 *
	 * @param int    $meta_id    Meta row id (unused).
	 * @param int    $post_id    Post id.
	 * @param string $meta_key   Meta key.
	 * @param mixed  $meta_value Meta value.
	 */
	public static function sync_terms_from_meta( $meta_id, $post_id, $meta_key, $meta_value ) {
		unset( $meta_id );
		if ( self::META_KEY !== $meta_key || 'gp_project' !== get_post_type( $post_id ) ) {
			return;
		}
		$content = GardenProof_Content::decode( $meta_value );
		if ( ! $content ) {
			return;
		}
		$facts = isset( $content['view']['facts'] ) && is_array( $content['view']['facts'] ) ? $content['view']['facts'] : array();
		$terms = array(
			'gp_service' => isset( $facts['service'] ) ? (string) $facts['service'] : '',
			'gp_area'    => isset( $facts['area'] ) ? (string) $facts['area'] : '',
		);
		foreach ( $terms as $taxonomy => $name ) {
			$name = sanitize_text_field( $name );
			wp_set_object_terms( $post_id, '' === $name ? array() : array( $name ), $taxonomy, false );
		}
	}
}
