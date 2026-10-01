<?php
/**
 * Front-end styles, the before/after script and the lead tracker.
 *
 * @package GardenProof
 */

defined( 'ABSPATH' ) || exit;

/**
 * Styles load only where our markup appears; the tracker loads site-wide (it must see the landing page
 * and the contact form) once an app URL is configured.
 */
class GardenProof_Assets {

	/**
	 * Hook up.
	 */
	public static function init() {
		add_action( 'wp_enqueue_scripts', array( __CLASS__, 'enqueue' ) );
	}

	/**
	 * Whether the current request renders GardenProof markup.
	 *
	 * @return bool
	 */
	private static function needs_styles() {
		if ( is_singular( array( 'gp_project', 'gp_article' ) ) || is_post_type_archive( 'gp_project' ) || is_tax( array( 'gp_service', 'gp_area' ) ) ) {
			return true;
		}
		$post = get_post();
		return $post && has_shortcode( (string) $post->post_content, 'gardenproof_portfolio' );
	}

	/**
	 * Enqueue assets.
	 */
	public static function enqueue() {
		$settings = GardenProof_Settings::get();

		if ( self::needs_styles() ) {
			$deps = array();
			if ( $settings['load_font'] ) {
				wp_enqueue_style( 'gardenproof-arvo', 'https://fonts.googleapis.com/css2?family=Arvo:wght@400;700&display=swap', array(), null );
				$deps[] = 'gardenproof-arvo';
			}
			wp_enqueue_style( 'gardenproof', GARDENPROOF_URL . 'assets/gardenproof.css', $deps, GARDENPROOF_VERSION );
			if ( is_singular( 'gp_project' ) ) {
				wp_enqueue_script( 'gardenproof-before-after', GARDENPROOF_URL . 'assets/before-after.js', array(), GARDENPROOF_VERSION, array( 'strategy' => 'defer' ) );
			}
		}

		if ( $settings['tracking'] && $settings['app_url'] ) {
			wp_enqueue_script( 'gardenproof-track', $settings['app_url'] . '/gp-track.js', array(), GARDENPROOF_VERSION, array( 'strategy' => 'defer' ) );
			wp_add_inline_script(
				'gardenproof-track',
				'window.GP_TRACK=' . wp_json_encode(
					array(
						'appUrl' => $settings['app_url'],
						'tenant' => $settings['tenant'],
					)
				) . ';',
				'before'
			);
		}
	}
}
