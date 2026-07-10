extends Node

# On touch devices the 1920x1080 desktop layout is shrunk onto a small screen,
# making text unreadably small. Compute a content scale from the actual window
# size so the UI reflows to a phone-friendly virtual width, portrait or
# landscape. The web shell can force an exact value via ?uiscale=N (stored in
# window.MOBILE_UI_SCALE_OVERRIDE by bootstrap.js) for desktop testing/tuning.

const PORTRAIT_TARGET_WIDTH := 800.0
const LANDSCAPE_TARGET_WIDTH := 950.0
const DESIGN_WIDTH := 1920.0
const DESIGN_HEIGHT := 1080.0

var _active := false

# Other scripts (e.g. UIPractice) check this to switch to phone-friendly layouts.
func is_active() -> bool:
	return _active

func _ready() -> void:
	var forced := false
	if OS.has_feature("web"):
		var force_flag: Variant = JavaScriptBridge.eval("window.FORCE_UI_SCALE ? 1 : 0")
		forced = force_flag is float and force_flag > 0.0
	if not DisplayServer.is_touchscreen_available() and not forced:
		return
	_active = true
	# The project ships with aspect "keep_height", which letterboxes (black
	# bars) when the window is taller than 16:9, i.e. on every portrait phone.
	# "expand" fills the whole window at the same scale instead.
	get_window().content_scale_aspect = Window.CONTENT_SCALE_ASPECT_EXPAND
	get_window().size_changed.connect(_update_scale)
	# The on-screen keyboard's hidden HTML input steals browser focus, which
	# makes the engine hide text carets. Force every text editor in the app to
	# keep a solid, thick caret so users can see where they are typing.
	get_tree().node_added.connect(_on_node_added)
	_update_scale()

func _on_node_added(node: Node) -> void:
	if node is TextEdit:
		# NOTE: this engine build has no TextEdit.caret_force_displayed
		# property — assigning it here silently killed the rest of this branch.
		var editor := node as TextEdit
		editor.caret_blink = false
		editor.add_theme_constant_override("caret_width", 3)
	elif node is RichTextLabel:
		# Selectable text swallows touch drags (starts selecting instead of
		# letting the ScrollContainer pan). On touch devices, scrolling wins.
		(node as RichTextLabel).selection_enabled = false

func _update_scale() -> void:
	if not _active:
		return
	var window_size := Vector2(get_window().size)
	if window_size.x <= 0.0 or window_size.y <= 0.0:
		return
	# Judge orientation by the physical screen, not the window: with the
	# on-screen keyboard open the window is wider than tall even though the
	# phone is still held in portrait.
	var screen_size := Vector2(DisplayServer.screen_get_size())
	if screen_size.x <= 0.0 or screen_size.y <= 0.0:
		screen_size = window_size
	var target_width := (
		PORTRAIT_TARGET_WIDTH if screen_size.x < screen_size.y
		else LANDSCAPE_TARGET_WIDTH
	)
	# With stretch canvas_items + aspect expand, the base scale is
	# min(window/design) per axis, times content_scale_factor; the virtual
	# width is window_width / effective scale. Solve for the factor that makes
	# the virtual width equal target_width. Screen density cancels out.
	var min_ratio := minf(window_size.x / DESIGN_WIDTH, window_size.y / DESIGN_HEIGHT)
	var ui_scale := window_size.x / (target_width * min_ratio)
	if OS.has_feature("web"):
		var override: Variant = JavaScriptBridge.eval("window.MOBILE_UI_SCALE_OVERRIDE || 0")
		if override is float and override > 0.5:
			ui_scale = override
	get_window().content_scale_factor = clampf(ui_scale, 0.75, 6.0)
