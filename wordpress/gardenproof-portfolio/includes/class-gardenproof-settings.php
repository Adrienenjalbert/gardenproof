<?php
/**
 * Settings → GardenProof.
 *
 * @package GardenProof
 */

defined( 'ABSPATH' ) || exit;

/**
 * Stores the GardenProof app URL + tenant slug (for lead tracking) and presentation toggles.
 * Uses the Settings API, which handles the nonce; saving requires manage_options.
 */
class GardenProof_Settings {

	const OPTION = 'gardenproof_settings';

	/**
	 * Hook up.
	 */
	public static function init() {
		add_action( 'admin_init', array( __CLASS__, 'register' ) );
		add_action( 'admin_menu', array( __CLASS__, 'menu' ) );
	}

	/**
	 * Current settings merged with defaults.
	 *
	 * @return array{app_url:string,tenant:string,tracking:bool,load_font:bool,cta_url:string}
	 */
	public static function get() {
		$saved = get_option( self::OPTION, array() );
		return wp_parse_args(
			is_array( $saved ) ? $saved : array(),
			array(
				'app_url'   => '',
				'tenant'    => '',
				'tracking'  => true,
				'load_font' => true,
				'cta_url'   => '',
			)
		);
	}

	/**
	 * Register the option and its fields.
	 */
	public static function register() {
		register_setting(
			'gardenproof',
			self::OPTION,
			array(
				'type'              => 'array',
				'sanitize_callback' => array( __CLASS__, 'sanitize' ),
				'default'           => array(),
			)
		);
		add_settings_section( 'gardenproof_main', __( 'Connection & tracking', 'gardenproof-portfolio' ), '__return_false', 'gardenproof' );

		$fields = array(
			'app_url'   => __( 'GardenProof app URL', 'gardenproof-portfolio' ),
			'tenant'    => __( 'Tenant slug', 'gardenproof-portfolio' ),
			'tracking'  => __( 'Lead tracking', 'gardenproof-portfolio' ),
			'cta_url'   => __( 'Consultation page URL (optional override)', 'gardenproof-portfolio' ),
			'load_font' => __( 'Load Arvo from Google Fonts', 'gardenproof-portfolio' ),
		);
		foreach ( $fields as $key => $label ) {
			add_settings_field( 'gardenproof_' . $key, $label, array( __CLASS__, 'field' ), 'gardenproof', 'gardenproof_main', array( 'key' => $key ) );
		}
	}

	/**
	 * Validate submitted settings.
	 *
	 * @param mixed $input Raw input.
	 * @return array
	 */
	public static function sanitize( $input ) {
		if ( ! current_user_can( 'manage_options' ) ) {
			return self::get();
		}
		$input = is_array( $input ) ? $input : array();
		$url   = isset( $input['app_url'] ) ? esc_url_raw( trim( (string) $input['app_url'] ), array( 'https', 'http' ) ) : '';
		$cta   = isset( $input['cta_url'] ) ? esc_url_raw( trim( (string) $input['cta_url'] ), array( 'https', 'http' ) ) : '';
		return array(
			'app_url'   => untrailingslashit( $url ),
			'tenant'    => isset( $input['tenant'] ) ? sanitize_key( $input['tenant'] ) : '',
			'tracking'  => ! empty( $input['tracking'] ),
			'load_font' => ! empty( $input['load_font'] ),
			'cta_url'   => $cta,
		);
	}

	/**
	 * Render one field.
	 *
	 * @param array $args { key }.
	 */
	public static function field( $args ) {
		$settings = self::get();
		$key      = $args['key'];
		$name     = self::OPTION . '[' . $key . ']';
		if ( in_array( $key, array( 'tracking', 'load_font' ), true ) ) {
			$help = 'tracking' === $key
				? __( 'Adds gp-track.js: remembers how visitors arrived (utm tags, ad click ids, landing page, last project viewed) in their own browser storage and attaches it to Contact Form 7 enquiries. No cookies.', 'gardenproof-portfolio' )
				: __( 'Turn off if your theme already loads Arvo, or to avoid requests to Google.', 'gardenproof-portfolio' );
			printf(
				'<label><input type="checkbox" name="%s" value="1" %s> %s</label>',
				esc_attr( $name ),
				checked( (bool) $settings[ $key ], true, false ),
				esc_html( $help )
			);
			return;
		}
		$placeholders = array(
			'app_url' => 'https://app.gardenproof.co.uk',
			'tenant'  => 'thorburn',
			'cta_url' => home_url( '/contact/' ),
		);
		printf(
			'<input type="%s" class="regular-text" name="%s" value="%s" placeholder="%s">',
			'tenant' === $key ? 'text' : 'url',
			esc_attr( $name ),
			esc_attr( (string) $settings[ $key ] ),
			esc_attr( $placeholders[ $key ] )
		);
	}

	/**
	 * Add the settings page.
	 */
	public static function menu() {
		add_options_page(
			__( 'GardenProof', 'gardenproof-portfolio' ),
			__( 'GardenProof', 'gardenproof-portfolio' ),
			'manage_options',
			'gardenproof',
			array( __CLASS__, 'page' )
		);
	}

	/**
	 * Settings page markup.
	 */
	public static function page() {
		if ( ! current_user_can( 'manage_options' ) ) {
			wp_die( esc_html__( 'You do not have permission to manage these settings.', 'gardenproof-portfolio' ) );
		}
		?>
		<div class="wrap">
			<h1><?php esc_html_e( 'GardenProof', 'gardenproof-portfolio' ); ?></h1>
			<p><?php esc_html_e( 'Projects and advice articles are published here by GardenProof after the agency approves them. Use the shortcode [gardenproof_portfolio] to show a filterable project grid on any page.', 'gardenproof-portfolio' ); ?></p>
			<form method="post" action="options.php">
				<?php
				settings_fields( 'gardenproof' );
				do_settings_sections( 'gardenproof' );
				submit_button();
				?>
			</form>
		</div>
		<?php
	}
}
