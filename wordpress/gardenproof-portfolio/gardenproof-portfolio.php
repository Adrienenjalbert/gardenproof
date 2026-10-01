<?php
/**
 * Plugin Name:       GardenProof Portfolio
 * Plugin URI:        https://gardenproof.app
 * Description:       Case-study project pages, advice articles, a filterable portfolio shortcode and lead attribution, published from GardenProof.
 * Version:           1.0.0
 * Requires at least: 6.0
 * Requires PHP:      7.4
 * Author:            GardenProof
 * License:           GPL-2.0-or-later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       gardenproof-portfolio
 *
 * @package GardenProof
 */

defined( 'ABSPATH' ) || exit;

define( 'GARDENPROOF_VERSION', '1.0.0' );
define( 'GARDENPROOF_FILE', __FILE__ );
define( 'GARDENPROOF_DIR', plugin_dir_path( __FILE__ ) );
define( 'GARDENPROOF_URL', plugin_dir_url( __FILE__ ) );

require_once GARDENPROOF_DIR . 'includes/class-gardenproof-content.php';
require_once GARDENPROOF_DIR . 'includes/class-gardenproof-post-types.php';
require_once GARDENPROOF_DIR . 'includes/class-gardenproof-templates.php';
require_once GARDENPROOF_DIR . 'includes/class-gardenproof-seo.php';
require_once GARDENPROOF_DIR . 'includes/class-gardenproof-shortcode.php';
require_once GARDENPROOF_DIR . 'includes/class-gardenproof-settings.php';
require_once GARDENPROOF_DIR . 'includes/class-gardenproof-assets.php';

GardenProof_Post_Types::init();
GardenProof_Templates::init();
GardenProof_Seo::init();
GardenProof_Shortcode::init();
GardenProof_Settings::init();
GardenProof_Assets::init();

/**
 * Register post types before flushing so /projects/ resolves straight after activation.
 */
function gardenproof_activate() {
	GardenProof_Post_Types::register();
	flush_rewrite_rules();
}
register_activation_hook( __FILE__, 'gardenproof_activate' );

/**
 * Remove our rewrite rules on deactivation.
 */
function gardenproof_deactivate() {
	flush_rewrite_rules();
}
register_deactivation_hook( __FILE__, 'gardenproof_deactivate' );
