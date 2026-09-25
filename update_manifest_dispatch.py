import json

path = r'C:\Users\vuenxx\.gemini\antigravity\scratch\vuenxxFG\src\main\modules\official\optibuilder\manifest.json'

with open(path, 'r', encoding='utf-8') as f:
    data = json.load(f)

# Update schema for DispatchFlags
data['config'][0]['schema']['DLSSG']['DispatchFlags'] = {
    "label": "Dispatch Flags",
    "labelKey": "modSettings.labels.dispatchFlags",
    "type": "dropdown",
    "options": [
        { "val": "auto", "label": "Auto" },
        { "val": "0x14100000", "label": "0x14100000" },
        { "val": "0x4100000", "label": "0x4100000" }
    ]
}

# Update preset values
data['config'][0]['presets']['dev-optibuilder-fg']['values']['DLSSG.DispatchFlags'] = "0x14100000"

with open(path, 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=4, ensure_ascii=False)
