/* jslint node: true */
'use strict';

//	ENiGMA½
const PluginModule			= require('./plugin_module.js').PluginModule;
const Config				= require('./config.js').config;
const Log					= require('./logger.js').log;

const _						= require('lodash');
const later					= require('later');
const path					= require('path');
const pty					= require('ptyw.js');
const gaze					= require('gaze');

exports.getModule				= EventSchedulerModule;
exports.EventSchedulerModule	= EventSchedulerModule;	//	allow for loadAndStart

exports.moduleInfo = {
	name	: 'Event Scheduler',
	desc	: 'Support for scheduling arbritary events',
	author	: 'NuSkooler',
};

const SCHEDULE_REGEXP	= /(?:^|or )?(@watch\:)([^\0]+)?$/;
const ACTION_REGEXP		= /\@(method|execute)\:([^\0]+)?$/;

class ScheduledEvent {
	constructor(events, name) {
		this.name		= name;
		this.schedule 	= this.parseScheduleString(events[name].schedule);
		this.action		= this.parseActionSpec(events[name].action);
		if(this.action) {
			this.action.args = events[name].args || [];
		}	
	}
	
	get isValid() {
		if((!this.schedule || (!this.schedule.sched && !this.schedule.watchFile)) || !this.action) {
			return false;
		}
		
		if('method' === this.action.type && !this.action.location) {
			return false;
		}
		
		return true; 	
	}
		
	parseScheduleString(schedStr) {
		if(!schedStr) {
			return false;
		}
		
		let schedule = {};
		
		const m = SCHEDULE_REGEXP.exec(schedStr);
		if(m) {
			schedStr = schedStr.substr(0, m.index).trim();
			
			if('@watch:' === m[1]) {
				schedule.watchFile = m[2];
			}
		}

		if(schedStr.length > 0) {
			const sched = later.parse.text(schedStr);
			if(-1 === sched.error) {
				schedule.sched = sched;
			}	
		}
		
		//	return undefined if we couldn't parse out anything useful
		if(!_.isEmpty(schedule)) {
			return schedule;
		}
	}
	
	parseActionSpec(actionSpec) {
		if(actionSpec) {
			if('@' === actionSpec[0]) {
				const m = ACTION_REGEXP.exec(actionSpec);
				if(m) {
					if(m[2].indexOf(':') > -1) {
						const parts = m[2].split(':');
						return {
							type		: m[1],							
							location	: parts[0],
							what		: parts[1],
						};
					} else {
						return {
							type	: m[1],
							what	: m[2],
						};
					}
				}
			} else {
				return { 
					type	: 'execute',
					what	: actionSpec,
				};
			}			
		}	
	}

	executeAction(reason, cb) {
		Log.info( { eventName : this.name, action : this.action, reason : reason }, 'Executing scheduled event action...');

		if('method' === this.action.type) {
			const modulePath = path.join(__dirname, '../', this.action.location);	//	enigma-bbs base + supplied location (path/file.js')
			try {
				const methodModule = require(modulePath);
				methodModule[this.action.what](this.action.args, err => {
					if(err) {
						Log.debug(
							{ error : err.toString(), eventName : this.name, action : this.action },
							'Error performing scheduled event action');
					}
					
					return cb(err);
				});
			} catch(e) {
				Log.warn(
					{ error : e.toString(), eventName : this.name, action : this.action },
					'Failed to perform scheduled event action');
				
				return cb(e);
			}
		} else if('execute' === this.action.type) {
			const opts = {
				//	:TODO: cwd
				name	: this.name,
				cols	: 80,
				rows	: 24,
				env		: process.env,	
			};

			const proc = pty.spawn(this.action.what, this.action.args, opts);

			proc.once('exit', exitCode => {				
				if(exitCode) {
					Log.warn(
						{ eventName : this.name, action : this.action, exitCode : exitCode },
						'Bad exit code while performing scheduled event action');
				}
				return cb(exitCode ? new Error(`Bad exit code while performing scheduled event action: ${exitCode}`) : null); 
			});
		}
	}
}

function EventSchedulerModule(options) {
	PluginModule.call(this, options);
	
	if(_.has(Config, 'eventScheduler')) {
		this.moduleConfig = Config.eventScheduler;
	}
	
	const self = this;
	this.runningActions = new Set();
	
	this.performAction = function(schedEvent, reason) {
		if(self.runningActions.has(schedEvent.name)) {
			return;	//	already running
		} 
		
		self.runningActions.add(schedEvent.name);

		schedEvent.executeAction(reason, () => {
			self.runningActions.delete(schedEvent.name);
		});		
	};
}

//	convienence static method for direct load + start
EventSchedulerModule.loadAndStart = function(cb) {
	const loadModuleEx = require('./module_util.js').loadModuleEx;
			
	const loadOpts = {
		name		: path.basename(__filename, '.js'),
		path		: __dirname,
	};
	
	loadModuleEx(loadOpts, (err, mod) => {
		if(err) {
			return cb(err);
		}
		
		const modInst = new mod.getModule();
		modInst.startup( err => {
			return cb(err, modInst);
		});		
	});
};

EventSchedulerModule.prototype.startup = function(cb) {
	
	this.eventTimers	= [];
	const self = this;
	
	if(this.moduleConfig && _.has(this.moduleConfig, 'events')) {
		const events = Object.keys(this.moduleConfig.events).map( name => {
			return new ScheduledEvent(this.moduleConfig.events, name);
		});
		
		events.forEach( schedEvent => {
			if(!schedEvent.isValid) {
				Log.warn( { eventName : schedEvent.name }, 'Invalid scheduled event entry');
				return;
			}
			
			Log.debug(
				{ 
					eventName	: schedEvent.name,
					schedule	: this.moduleConfig.events[schedEvent.name].schedule,
					action		: schedEvent.action,
				},
				'Scheduled event loaded'
			);

			if(schedEvent.schedule.sched) {			
				this.eventTimers.push(later.setInterval( () => {
					self.performAction(schedEvent, 'Schedule');	
				}, schedEvent.schedule.sched));
			}

			if(schedEvent.schedule.watchFile) {				
				gaze(schedEvent.schedule.watchFile, (err, watcher) => {
					//	:TODO: should track watched files & stop watching @ shutdown
					watcher.on('all', (watchEvent, watchedPath) => {
						if(schedEvent.schedule.watchFile === watchedPath) {
							self.performAction(schedEvent, `Watch file: ${watchedPath}`);
						}
					});
				});
			}
		});
	}
	
	cb(null);
};

EventSchedulerModule.prototype.shutdown = function(cb) {
	if(this.eventTimers) {
		this.eventTimers.forEach( et => et.clear() );
	}
		
	cb(null);
};
