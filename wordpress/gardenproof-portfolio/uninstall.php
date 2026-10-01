<?php
/**
 * Remove plugin settings on uninstall. Projects and articles are content and are deliberately kept.
 *
 * @package GardenProof
 */

defined( 'WP_UNINSTALL_PLUGIN' ) || exit;

delete_option( 'gardenproof_settings' );
