/* jslint node: true */
'use strict';

var TextView				= require('./text_view.js').TextView;
var EditTextView			= require('./edit_text_view.js').EditTextView;
var ButtonView				= require('./button_view.js').ButtonView;
var VerticalMenuView		= require('./vertical_menu_view.js').VerticalMenuView;
var HorizontalMenuView		= require('./horizontal_menu_view.js').HorizontalMenuView;
var SpinnerMenuView			= require('./spinner_menu_view.js').SpinnerMenuView;
var ToggleMenuView			= require('./toggle_menu_view.js').ToggleMenuView;
var MaskEditTextView		= require('./mask_edit_text_view.js').MaskEditTextView;
var StatusBarView			= require('./status_bar_view.js').StatusBarView;
var MultiLineEditTextView	= require('./multi_line_edit_text_view.js').MultiLineEditTextView;
var getPredefinedMCIValue	= require('./predefined_mci.js').getPredefinedMCIValue;
var ansi					= require('./ansi_term.js');

var packageJson 			= require('../package.json');

var assert					= require('assert');
var _						= require('lodash');

exports.MCIViewFactory		= MCIViewFactory;

function MCIViewFactory(client) {
	this.client = client;
}

MCIViewFactory.UserViewCodes = [
	'TL', 'ET', 'ME', 'MT', 'PL', 'BT', 'VM', 'HM', 'SM', 'TM',

	//
	//	XY is a special MCI code that allows finding positions
	//	and counts for key lookup, but does not explicitly
	//	represent a visible View on it's own
	//
	'XY',
];

MCIViewFactory.prototype.createFromMCI = function(mci, cb) {
	assert(mci.code);
	assert(mci.id > 0);
	assert(mci.position);

	var view;
	var options = {
		client			: this.client,
		id				: mci.id,
		ansiSGR			: mci.SGR,
		ansiFocusSGR	: mci.focusSGR,
		position		: { row : mci.position[0], col : mci.position[1] },
	};

	//	:TODO: These should use setPropertyValue()!
	function setOption(pos, name) {
		if(mci.args.length > pos && mci.args[pos].length > 0) {
			options[name] = mci.args[pos];
		}
	}

	function setWidth(pos) {
		if(mci.args.length > pos && mci.args[pos].length > 0) {
			if(!_.isObject(options.dimens)) {
				options.dimens = {};
			}
			options.dimens.width = parseInt(mci.args[pos], 10);
		}
	}

	function setFocusOption(pos, name) {
		if(mci.focusArgs && mci.focusArgs.length > pos && mci.focusArgs[pos].length > 0) {
			options[name] = mci.focusArgs[pos];
		}
	}

	//
	//	Note: Keep this in sync with UserViewCodes above!
	//
	switch(mci.code) {
		//	Text Label (Text View)
		case 'TL' : 
			setOption(0,	'textStyle');
			setOption(1,	'justify');
			setWidth(2);

			view = new TextView(options);
			break;

		//	Edit Text
		case 'ET' :
			setWidth(0);

			setOption(1, 		'textStyle');
			setFocusOption(0,	'focusTextStyle');

			view = new EditTextView(options);
			break;

		//	Masked Edit Text
		case 'ME' :
			setOption(0,		'textStyle');
			setFocusOption(0,	'focusTextStyle');

			view = new MaskEditTextView(options);
			break;

		//	Multi Line Edit Text
		case 'MT' : 
			//	:TODO: apply params
			view = new MultiLineEditTextView(options);
			break;

		//	Pre-defined Label (Text View)
		//	:TODO: Currently no real point of PL -- @method replaces this pretty much... probably remove
		case 'PL' : 
			if(mci.args.length > 0) {
				options.text = getPredefinedMCIValue(this.client, mci.args[0]);
				if(options.text) {
					setOption(1, 'textStyle');
					setOption(2, 'justify');
					setWidth(3);

					view = new TextView(options);
				}
			}
			break;

		//	Button
		case 'BT' : 
			if(mci.args.length > 0) {
				options.dimens = { width : parseInt(mci.args[0], 10) };
			}

			setOption(1, 'textStyle');
			setOption(2, 'justify');

			setFocusOption(0, 'focusTextStyle');

			view = new ButtonView(options);
			break;

		//	Vertial Menu
		case 'VM' :
			setOption(0,		'itemSpacing');
			setOption(1, 		'justify');
			setOption(2, 		'textStyle');
			
			setFocusOption(0,	'focusTextStyle');

			view = new VerticalMenuView(options);
			break;

		//	Horizontal Menu
		case 'HM' : 
			setOption(0,		'itemSpacing');
			setOption(1,		'textStyle');

			setFocusOption(0,	'focusTextStyle');

			view = new HorizontalMenuView(options);
			break;

		case 'SM' :
			setOption(0,		'textStyle');
			setOption(1, 		'justify');

			setFocusOption(0,	'focusTextStyle');
			
			view = new SpinnerMenuView(options);
			break;

		case 'TM' :
			if(mci.args.length > 0) {
				var styleSG1 = { fg : parseInt(mci.args[0], 10) };
				if(mci.args.length > 1) {
					styleSG1.bg = parseInt(mci.args[1], 10);
				}
				options.styleSG1 = ansi.getSGRFromGraphicRendition(styleSG1, true);
			}

			setFocusOption(0,	'focusTextStyle');

			view = new ToggleMenuView(options);
			break;

		default :
			options.text = getPredefinedMCIValue(this.client, mci.code);
			if(_.isString(options.text)) {
				setWidth(0);

				setOption(1,	'textStyle');
				setOption(2,	'justify');

				view = new TextView(options);
			}
			break;
	}

	return view;
};
