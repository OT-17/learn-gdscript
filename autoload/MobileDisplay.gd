extends Node

# On touch devices the 1920x1080 desktop layout is shrunk onto a small screen,
# making text unreadably small. Bump the content scale so the UI reflows at a
# phone-friendly size. The web shell can override the value via
# window.MOBILE_UI_SCALE (see html_export/static/bootstrap.js), which lets us
# tune the number without re-exporting the project.

const DEFAULT_MOBILE_SCALE := 1.75

func _ready() -> void:
	if not DisplayServer.is_touchscreen_available():
		return
	var ui_scale := DEFAULT_MOBILE_SCALE
	if OS.has_feature("web"):
		var override: Variant = JavaScriptBridge.eval("window.MOBILE_UI_SCALE || 0")
		if override is float and override > 0.5:
			ui_scale = override
	get_window().content_scale_factor = ui_scale
