const Main = imports.ui.main;
const Mainloop = imports.mainloop;
const Meta = imports.gi.Meta;
const Lang = imports.lang;
const Shell = imports.gi.Shell;
const Me = imports.misc.extensionUtils.getCurrentExtension();
const Convenience = Me.imports.convenience;
const Gdk = imports.gi.Gdk

function log() {
    // global.log.apply(null, arguments); // uncomment when debugging
}

const Mode = Object.freeze({
    "ALWAYS_RUN": "always-run", // both runs the command and raises a window
    "RUN_ONLY": "run-only", // just runs the command without cycling windows
    "ISOLATE_WORKSPACE": "isolate-workspace", // Switch windows on the active workspace only
    "MINIMIZE_WHEN_UNFOCUSED": "minimize-when-unfocused",
    "SWITCH_BACK_WHEN_FOCUSED": "switch-back-when-focused",
    "MOVE_WINDOW_TO_ACTIVE_WORKSPACE": "move-window-to-active-workspace",
    "CENTER_MOUSE_TO_FOCUSED_WINDOW": "center-mouse-to-focused-window"
})


const KeyManager = new Lang.Class({ // based on https://superuser.com/questions/471606/gnome-shell-extension-key-binding/1182899#1182899
    Name: 'MyKeyManager',

    _init: function() {
        this.grabbers = new Map()

        global.display.connect(
            'accelerator-activated',
            Lang.bind(this, function(display, action, deviceId, timestamp) {
                log('Accelerator Activated: [display={}, action={}, deviceId={}, timestamp={}]',
                    display, action, deviceId, timestamp)
                this._onAccelerator(action)
            }))
    },

    listenFor: function(accelerator, callback) {

        log('Trying to listen for hot key', accelerator)
        let action = global.display.grab_accelerator(accelerator, 0)
        if (action === Meta.KeyBindingAction.NONE) {
            log('Unable to grab accelerator [binding={}]', accelerator)
        } else {
            // Grabbed accelerator action
            // Receive binding name for action
            let name = Meta.external_binding_name_for_action(action)

            // Requesting WM to allow binding name
            Main.wm.allowKeybinding(name, Shell.ActionMode.ALL)

            this.grabbers.set(action, {
                name: name,
                accelerator: accelerator,
                callback: callback,
                action: action
            })
        }

    },

    _onAccelerator: function(action) {
        let grabber = this.grabbers.get(action)

        if (grabber) {
            this.grabbers.get(action).callback()
        } else {
            log('No listeners [action={}]', action)
        }
    }
});


const Controller = new Lang.Class({ // based on https://superuser.com/questions/471606/gnome-shell-extension-key-binding/1182899#1182899
    Name: 'MyController',

    /**
     * Closure returns the event handler triggered by system on a shortcut
     * @param command
     * @param wm_class
     * @param title
     * @param {dict(mode, parameter)} mode
     * @return function
     */
    raise: function(command = "", wm_class = "", title = "", modes = null) {
        /**
         * Return appropriate method for s, depending if s is a regex (search) or a string (indexOf)
         * @param s
         * @return {(string|string)[]|(RegExp|string)[]} Tuple
         * @private
         */
        function _allow_regex(s) {
            if (!s) {
                return [s, () => {
                }]
            } else if (s.substr(0, 1) === "/" && s.slice(-1) === "/") {
                // s is surround with slashes, ex: `/my-program/`, we want to do a regular match when searching
                return [new RegExp(s.substr(1, s.length - 2)), "search"];
            } else {  // s is a classic string, we just do indexOf match
                return [s, "indexOf"];
            }
        }

        function is_conforming(wm) {
            const window_class = wm.get_wm_class() || '';
            const window_title = wm.get_title() || '';
            // check if the current window is conforming to the search criteria
            if (wm_class) { // seek by class
                // wm_class AND if set, title must match
                if (window_class[wmFn](wm_class) > -1 && (!title || window_title[titleFn](title) > -1)) {
                    return true;
                }
            } else if ((title && window_title[titleFn](title) > -1) || // seek by title
                (!title && ((window_class.toLowerCase().indexOf(command.toLowerCase()) > -1) || // seek by launch-command in wm_class
                    (window_title.toLowerCase().indexOf(command.toLowerCase()) > -1))) // seek by launch-command in title
            ) {
                return true;
            }
            return false;
        };

        let wmFn, titleFn;
        [wm_class, wmFn] = _allow_regex(wm_class);
        [title, titleFn] = _allow_regex(title);

        return function() {

            if (modes[Mode.RUN_ONLY]) {
                imports.misc.util.spawnCommandLine(command)
                return
            }

            /**
             * @type {window}
             */
            let seen = null;

            // Switch windows on active workspace only
            let active_workspace;
            const workspace_manager = global.display.get_workspace_manager();
            if (settings.get_boolean('isolate-workspace') || modes[Mode.ISOLATE_WORKSPACE]) {
                active_workspace = workspace_manager.get_active_workspace();
            } else {
                active_workspace = null;
            }

            let windows;
            if (global.display.get_tab_list(0, active_workspace).length === 0) {
                windows = [];
            } else if (is_conforming(global.display.get_tab_list(0, active_workspace)[0])) {
                // current window conforms, let's focus the oldest windows of the group
                windows = global.display.get_tab_list(0, active_workspace).slice(0).reverse();
            } else {
                // current window doesn't conform, let's find the youngest conforming one
                windows = global.display.get_tab_list(0, active_workspace); // Xglobal.get_window_actors()
            }
            for (let window of windows) {
                if (is_conforming(window)) {
                    seen = window;
                    if (!seen.has_focus()) {
                        break; // there might exist another window having the same parameters
                    }
                }
            }
            if (seen) {
                if (!seen.has_focus()) {
                    log('no focus, go to:' + seen.get_wm_class());
                    focusWindow(seen, modes);
                } else {
                    if (settings.get_boolean('minimize-when-unfocused') || modes[Mode.MINIMIZE_WHEN_UNFOCUSED]) {
                        seen.minimize();
                    }
                    if (settings.get_boolean('switch-back-when-focused') || modes[Mode.SWITCH_BACK_WHEN_FOCUSED]) {
                        const window_monitor = wm.get_monitor();
                        const window_list = global.display.get_tab_list(0, active_workspace).filter(w => w.get_monitor() === window_monitor && w !== wm);
                        const lastWindow = window_list[0];
                        if (lastWindow) {
                            log('focus, go to:' + lastWindow.get_wm_class());
                            focusWindow(lastWindow, modes);
                        }
                    }
                }
            }
            if (!seen || modes[Mode.ALWAYS_RUN]) {
                imports.misc.util.spawnCommandLine(command);
            }
        }
    },

    enable: function() {
        let s;
        try {
            s = Shell.get_file_contents_utf8_sync(confpath);
        } catch (e) {
            log("Run or raise: can't load confpath" + confpath + ", creating new file from default");
            // imports.misc.util.spawnCommandLine("cp " + defaultconfpath + " " + confpath);
            imports.misc.util.spawnCommandLine("mkdir -p " + confpath.substr(0, confpath.lastIndexOf("/")));
            imports.misc.util.spawnCommandLine("cp " + defaultconfpath + " " + confpath);
            try {
                s = Shell.get_file_contents_utf8_sync(defaultconfpath); // it seems confpath file is not ready yet, reading defaultconfpath
            } catch (e) {
                log("Run or raise: Failed to create default file")
                return;
            }
        }
        let shortcuts = s.split("\n");
        this.keyManager = new KeyManager();

        // parse shortcut file
        for (let line of shortcuts) {
            try {
                if (line[0] === "#" || line.trim() === "") {  // skip empty lines and comments
                    continue;
                }

                // Optional argument quoting in the format: `shortcut[:mode][:mode],[command],[wm_class],[title]`
                // ', b, c, "d, e,\" " f", g, h' -> ["", "b", "c", "d, e,\" \" f", "g", "h"]
                let arguments = line.split(/,(?![^"]*"(?:(?:[^"]*"){2})*[^"]*$)/)
                    .map(s => s.trim())
                    .map(s => (s[0] === '"' && s.slice(-1) === '"') ? s.slice(1, -1).trim() : s) // remove quotes
                let [shortcut_mode, command, wm_class, title] = arguments;

                // Split shortcut[:mode][:mode] -> shortcut, modes
                let [shortcut, ...modes] = shortcut_mode.split(":")
                shortcut = shortcut.trim()
                // Store to "shortcut:cmd:launch(2)" → modes = {"cmd": true, "launch": 2}
                modes = Object.assign({}, ...modes
                    .map(m => m.match(/(?<key>.*)(\((?<arg>.*?)\))?/)) // "launch" -> key=launch, arg=undefined
                    .filter(m => m && Object.values(Mode).includes(m.groups.key)) // "launch" must be a valid Mode
                    .map(m => ({[m.groups.key]: m.groups.arg || true}))) // {"launch": true}

                if (arguments.length <= 2) {
                    // Run only mode, we never try to raise a window
                    modes[Mode.RUN_ONLY] = true
                }

                this.keyManager.listenFor(shortcut, this.raise(command, wm_class, title, modes))
            } catch (e) {
                log("Run or raise: can't parse line: " + line, e)
            }
        }
    },

    disable: function() {
        for (let it of this.keyManager.grabbers) {
            try {
                global.display.ungrab_accelerator(it[1].action)
                Main.wm.allowKeybinding(it[1].name, Shell.ActionMode.NONE)
            } catch (e) {
                log("Run or raise: error removing keybinding " + it[1].name)
                log(e)
            }
        }
    }


});

var app, confpath, confdir, defaultconfpath, settings;

function init(options) {
    confpath = ".config/run-or-raise/shortcuts.conf"; // CWD seems to be HOME
    defaultconfpath = options.path + "/shortcuts.default";
    app = new Controller();
    settings = Convenience.getSettings();
}

function enable(settings) {
    app.enable();
}

function disable() {
    app.disable();
}

function focusWindow(wm, modes = null) {
    if (settings.get_boolean('move-window-to-active-workspace') || modes[Mode.MOVE_WINDOW_TO_ACTIVE_WORKSPACE]) {
        const activeWorkspace = global.workspaceManager.get_active_workspace();
        wm.change_workspace(activeWorkspace);
    }
    wm.get_workspace().activate_with_focus(wm, true);
    wm.activate(0);
    if (settings.get_boolean('center-mouse-to-focused-window') || modes[Mode.CENTER_MOUSE_TO_FOCUSED_WINDOW]) {
        const display = Gdk.Display.get_default();//wm.get_display();
        const deviceManager = display.get_device_manager();
        const pointer = deviceManager.get_client_pointer();
        const screen = pointer.get_position()[0];
        const center = wm.get_center();
        pointer.warp(screen, center.x, center.y);
    }
}
