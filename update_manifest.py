import json

path = r'C:\Users\vuenxx\.gemini\antigravity\scratch\vuenxxFG\src\main\modules\official\optibuilder\manifest.json'

with open(path, 'r', encoding='utf-8') as f:
    data = json.load(f)

# Update schema
data['config'][0]['schema'] = {
    "Upscalers": {
        "Dx11Upscaler": {
            "label": "Dx11 Upscaler",
            "type": "dropdown",
            "options": [
                { "val": "auto", "label": "Auto" },
                { "val": "fsr22", "label": "fsr22" },
                { "val": "fsr31", "label": "fsr31" },
                { "val": "xess", "label": "xess" },
                { "val": "xess_12", "label": "xess_12" },
                { "val": "fsr21_12", "label": "fsr21_12" },
                { "val": "fsr22_12", "label": "fsr22_12" },
                { "val": "ffx_12", "label": "ffx_12" },
                { "val": "dlss", "label": "dlss" }
            ]
        },
        "Dx12Upscaler": {
            "label": "Dx12 Upscaler",
            "type": "dropdown",
            "options": [
                { "val": "auto", "label": "Auto" },
                { "val": "xess", "label": "xess" },
                { "val": "fsr21", "label": "fsr21" },
                { "val": "fsr22", "label": "fsr22" },
                { "val": "ffx", "label": "ffx" },
                { "val": "dlss", "label": "dlss" }
            ]
        },
        "VulkanUpscaler": {
            "label": "Vulkan Upscaler",
            "type": "dropdown",
            "options": [
                { "val": "auto", "label": "Auto" },
                { "val": "fsr21", "label": "fsr21" },
                { "val": "fsr22", "label": "fsr22" },
                { "val": "ffx", "label": "ffx" },
                { "val": "xess", "label": "xess" },
                { "val": "fsr21_12", "label": "fsr21_12" },
                { "val": "ffx_12", "label": "ffx_12" },
                { "val": "dlss", "label": "dlss" }
            ]
        }
    },
    "FrameGen": {
        "Enabled": {
            "label": "Etkinleştirildi (Enabled)",
            "labelKey": "modSettings.labels.enabled",
            "type": "dropdown",
            "options": [
                { "val": "auto", "label": "Auto" },
                { "val": "true", "label": "Açık (True)" },
                { "val": "false", "label": "Kapalı (False)" }
            ]
        },
        "FGInput": {
            "label": "FG Girdisi (FGInput)",
            "labelKey": "modSettings.labels.fgInput",
            "type": "dropdown",
            "options": [
                { "val": "auto", "label": "Auto" },
                { "val": "nofg", "label": "nofg" },
                { "val": "dlssg", "label": "dlssg" },
                { "val": "nvngxfg", "label": "nvngxfg" },
                { "val": "fsrfg", "label": "fsrfg" },
                { "val": "upscaler", "label": "upscaler" },
                { "val": "fsrfg30", "label": "fsrfg30" }
            ]
        },
        "FGOutput": {
            "label": "FG Çıktısı (FGOutput)",
            "labelKey": "modSettings.labels.fgOutput",
            "type": "dropdown",
            "options": [
                { "val": "auto", "label": "Auto" },
                { "val": "nofg", "label": "nofg" },
                { "val": "fsrfg", "label": "fsrfg" },
                { "val": "xefg", "label": "xefg" },
                { "val": "dlssg", "label": "dlssg" }
            ]
        },
        "FGNvngxReplacement": {
            "label": "FG Nvngx Değişimi",
            "type": "dropdown",
            "options": [
                { "val": "auto", "label": "Auto" },
                { "val": "None", "label": "None" },
                { "val": "Nukems", "label": "Nukems" },
                { "val": "Arturs", "label": "Arturs" },
                { "val": "FFX", "label": "FFX" },
                { "val": "Combo", "label": "Combo" }
            ]
        }
    },
    "DLSSG": {
        "InterpolationCount": {
            "label": "Interpolasyon Sayısı",
            "labelKey": "modSettings.labels.interpolationCount",
            "type": "dropdown",
            "options": [
                { "val": "auto", "label": "Auto" },
                { "val": "1", "label": "2X" },
                { "val": "2", "label": "3X" },
                { "val": "3", "label": "4X" },
                { "val": "4", "label": "5X" },
                { "val": "5", "label": "6X" }
            ]
        }
    },
    "Menu": {
        "ShowFps": {
            "label": "FPS Göster",
            "labelKey": "modSettings.labels.showFps",
            "type": "dropdown",
            "options": [
                { "val": "auto", "label": "Auto" },
                { "val": "true", "label": "Açık" },
                { "val": "false", "label": "Kapalı" }
            ]
        },
        "FpsOverlayPos": {
            "label": "FPS Pozisyonu",
            "labelKey": "modSettings.labels.fpsOverlayPos",
            "type": "dropdown",
            "options": [
                { "val": "auto", "label": "Auto" },
                { "val": "0", "label": "Sol Üst" },
                { "val": "1", "label": "Sağ Üst" },
                { "val": "2", "label": "Sol Alt" },
                { "val": "3", "label": "Sağ Alt" }
            ]
        }
    }
}

data['config'][0]['presets'] = {
    "dev-optibuilder-fg": {
        "nameKey": "modSettings.presets.devOptiFgName",
        "locked": True,
        "values": {
            "Upscalers.Dx12Upscaler": "dlss",
            "FrameGen.Enabled": "true",
            "FrameGen.FGInput": "upscaler",
            "FrameGen.FGOutput": "dlssg",
            "FrameGen.FGNvngxReplacement": "Arturs",
            "DLSSG.InterpolationCount": "5",
            "Menu.ShowFps": "true",
            "Menu.FpsOverlayPos": "1"
        }
    }
}

with open(path, 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=4, ensure_ascii=False)
