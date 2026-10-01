<?php
/**
 * Template loading with theme overrides.
 *
 * @package GardenProof
 */

defined( 'ABSPATH' ) || exit;

/**
 * Uses the plugin's templates for gp_project / gp_article unless the theme ships its own
 * (single-gp_project.php in the theme root, or gardenproof/single-gp_project.php).
 */
class GardenProof_Templates {

	/**
	 * Hook up.
	 */
	public static function init() {
		add_filter( 'template_include', array( __CLASS__, 'template_include' ), 20 );
		add_filter( 'body_class', array( __CLASS__, 'body_class' ) );
	}

	/**
	 * Pick our template for the plugin's views.
	 *
	 * @param string $template Template chosen by WordPress.
	 * @return string
	 */
	public static function template_include( $template ) {
		$name = null;
		if ( is_singular( 'gp_project' ) ) {
			$name = 'single-gp_project.php';
		} elseif ( is_singular( 'gp_article' ) ) {
			$name = 'single-gp_article.php';
		} elseif ( is_post_type_archive( 'gp_project' ) || is_tax( array( 'gp_service', 'gp_area' ) ) ) {
			$name = 'archive-gp_project.php';
		}
		if ( ! $name || basename( $template ) === $name ) {
			return $template; // Not ours, or the theme already provides it.
		}
		$theme = locate_template( array( 'gardenproof/' . $name ) );
		return $theme ? $theme : GARDENPROOF_DIR . 'templates/' . $name;
	}

	/**
	 * Marker class for styling hooks.
	 *
	 * @param string[] $classes Body classes.
	 * @return string[]
	 */
	public static function body_class( $classes ) {
		if ( is_singular( array( 'gp_project', 'gp_article' ) ) || is_post_type_archive( 'gp_project' ) ) {
			$classes[] = 'gardenproof';
		}
		return $classes;
	}
}
