import json

path = r'C:\Users\vuenxx\.gemini\antigravity\scratch\vuenxxFG\src\main\modules\official\optibuilder\manifest.json'

with open(path, 'r', encoding='utf-8') as f:
    data = json.load(f)

# Get the options for DispatchFlags
options = data['config'][0]['schema']['NvngxFG']['DispatchFlags']['options']
# Keep everything except "0x4100000"
data['config'][0]['schema']['NvngxFG']['DispatchFlags']['options'] = [
    opt for opt in options if opt.get('val') != '0x4100000'
]

with open(path, 'w', encoding='utf-8') as f:
    json.dump(data, f, indent=4, ensure_ascii=False)
