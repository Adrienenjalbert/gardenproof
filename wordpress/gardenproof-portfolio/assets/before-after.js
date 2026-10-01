/**
 * GardenProof before/after slider (progressive enhancement of .gp-ba).
 * Drag anywhere with mouse, pen or touch (vertical scrolling still works), or focus the slider and use the
 * arrow keys / Home / End. A native range input carries the accessible name and value.
 */
( function () {
	'use strict';

	var ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M9 6l-6 6 6 6M15 6l6 6-6 6" stroke-linecap="round" stroke-linejoin="round"/></svg>';

	function enhance( root ) {
		if ( ! root.querySelector( '.gp-ba__before img' ) || ! root.querySelector( '.gp-ba__after img' ) ) {
			return;
		}
		var input = document.createElement( 'input' );
		input.type = 'range';
		input.min = '0';
		input.max = '100';
		input.step = '1';
		input.className = 'gp-ba__range';
		input.setAttribute( 'aria-label', root.getAttribute( 'data-label' ) || 'Compare before and after photos' );

		var line = document.createElement( 'div' );
		line.className = 'gp-ba__line';
		line.setAttribute( 'aria-hidden', 'true' );

		var handle = document.createElement( 'div' );
		handle.className = 'gp-ba__handle';
		handle.setAttribute( 'aria-hidden', 'true' );
		handle.innerHTML = ICON;

		root.appendChild( input );
		root.appendChild( line );
		root.appendChild( handle );
		root.classList.add( 'is-enhanced' );

		function set( pct ) {
			var p = Math.max( 0, Math.min( 100, Math.round( pct ) ) );
			input.value = String( p );
			input.setAttribute( 'aria-valuetext', p + '% of the before photo shown' );
			root.style.setProperty( '--gp-pos', p + '%' );
		}

		function fromPointer( e ) {
			var box = root.getBoundingClientRect();
			set( ( ( e.clientX - box.left ) / box.width ) * 100 );
		}

		var dragging = false;
		input.addEventListener( 'input', function () {
			set( Number( input.value ) );
		} );
		root.addEventListener( 'pointerdown', function ( e ) {
			dragging = true;
			root.setPointerCapture( e.pointerId );
			fromPointer( e );
		} );
		root.addEventListener( 'pointermove', function ( e ) {
			if ( dragging ) {
				fromPointer( e );
			}
		} );
		[ 'pointerup', 'pointercancel' ].forEach( function ( type ) {
			root.addEventListener( type, function () {
				dragging = false;
			} );
		} );
		set( 50 );
	}

	Array.prototype.forEach.call( document.querySelectorAll( '[data-gp-ba]' ), enhance );
}() );
