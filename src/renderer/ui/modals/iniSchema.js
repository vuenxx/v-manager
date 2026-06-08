export const DLSS_ENABLER_SCHEMA = {
    NGX: {
        ScreenSpaceRayTracing: { type: 'toggle', label: 'Screen Space Ray Tracing' },
        GlobalIllumination: { type: 'toggle', label: 'Global Illumination' },
        AmbientOcclusion: { type: 'toggle', label: 'Ambient Occlusion' },
        RayTracingQuality: { type: 'slider', label: 'RT Quality', min: 0, max: 3, step: 1 },
        RayTracingRange: { type: 'slider', label: 'RT Range', min: 0, max: 100, step: 1 },
        IlluminationStrength: { type: 'slider', label: 'Illumination Strength', min: 0, max: 100, step: 1 },
        OcclusionStrength: { type: 'slider', label: 'Occlusion Strength', min: 0, max: 100, step: 1 },
        HudDetectionMode: { type: 'dropdown', label: 'HUD Detection Mode', options: [
            { val: 0, label: 'Kapalı (0)', labelKey: 'modSettings.options.disabled0' },
            { val: 1, label: 'Mod 1', labelKey: 'modSettings.options.mode1' },
            { val: 2, label: 'Mod 2', labelKey: 'modSettings.options.mode2' }
        ]}
    },
    Reflex: {
        VsyncOverride: { type: 'toggle', label: 'Vsync Override' },
        Vsync: { type: 'toggle', label: 'Vsync' },
        FpsLimit: { type: 'toggle', label: 'FPS Limiti' },
        BoostOverride: { type: 'toggle', label: 'Boost Override' },
        Boost: { type: 'toggle', label: 'Boost' },
        DesiredFpsLimit: { type: 'slider', label: 'Hedef FPS Limiti', min: 30, max: 240, step: 1 }
    },
    UI: {
        Monitoring: { type: 'toggle', label: 'Monitoring' },
        SideBar: { type: 'toggle', label: 'SideBar' },
        ToggleKey: { type: 'text', label: 'Aç/Kapat Tuşu (Toggle Key)' },
        ScaleOverride: { type: 'slider', label: 'Scale Override', min: 0, max: 5, step: 1 }
    },
    DeepDVC: {
        Intensity: { type: 'slider', label: 'Intensity', min: 0, max: 1, step: 0.1 },
        SaturationBoost: { type: 'slider', label: 'Saturation Boost', min: 0, max: 1, step: 0.1 }
    },
    Performance: {
        OverdriveMode: { type: 'dropdown', label: 'Overdrive Mode', options: [{ val: 0, label: 'Kapalı', labelKey: 'modSettings.options.disabled' }, { val: 1, label: 'Açık', labelKey: 'modSettings.options.enabled' }] },
        HudInterpolation: { type: 'toggle', label: 'HUD Interpolation' },
        MFGOverrideMode: { type: 'dropdown', label: 'MFG Override Mode', options: [{ val: 0, label: 'Kapalı (0)', labelKey: 'modSettings.options.mfg0' }, { val: 1, label: '1X MFG (1)', labelKey: 'modSettings.options.mfg1' }, { val: 2, label: '2X MFG (2)', labelKey: 'modSettings.options.mfg2' }, { val: 3, label: '3X MFG (3)', labelKey: 'modSettings.options.mfg3' }, { val: 4, label: '4X MFG (4)', labelKey: 'modSettings.options.mfg4' }, { val: 5, label: '5X MFG (5)', labelKey: 'modSettings.options.mfg5' }, { val: 6, label: '6X MFG (6)', labelKey: 'modSettings.options.mfg6' }] },
        MFGHotkeys: { type: 'toggle', label: 'MFG Hotkeys' },
        DynamicMFG: { type: 'toggle', label: 'Dynamic MFG' },
        DynamicMFGThreshold2: { type: 'slider', label: 'Threshold 2', min: 0, max: 144, step: 1 },
        DynamicMFGThreshold3: { type: 'slider', label: 'Threshold 3', min: 0, max: 144, step: 1 },
        DynamicMFGThreshold4: { type: 'slider', label: 'Threshold 4', min: 0, max: 144, step: 1 },
        DynamicMFGThreshold5: { type: 'slider', label: 'Threshold 5', min: 0, max: 144, step: 1 },
        DFGMode: { type: 'dropdown', label: 'DFG Mode', options: [{ val: 0, label: 'Kapalı', labelKey: 'modSettings.options.disabled' }, { val: 1, label: 'Açık', labelKey: 'modSettings.options.enabled' }] },
        DFGTargetFps: { type: 'slider', label: 'DFG Target FPS', min: 30, max: 240, step: 1 },
        DFGInstinct: { type: 'toggle', label: 'DFG Instinct' },
        DFGMinFps: { type: 'slider', label: 'DFG Min FPS', min: 0, max: 144, step: 1 },
        ForceLoadDLSSG: { type: 'toggle', label: 'Force Load DLSSG' }
    },
    Debug: {
        Flags: { type: 'text', label: 'Flags' },
        EarlyInit: { type: 'toggle', label: 'Early Init' },
        UseFsrOnly: { type: 'toggle', label: 'Use FSR Only' },
        HybridMfgForced: { type: 'toggle', label: 'Hybrid MFG Forced' },
        DisableUI: { type: 'toggle', label: 'Disable UI' }
    },
    GhostBuster: {
        Enabled: { type: 'toggle', label: 'Enabled' },
        DebugMode: { type: 'dropdown', label: 'Debug Mode', options: [{ val: 0, label: 'Kapalı', labelKey: 'modSettings.options.disabled' }, { val: 1, label: 'Açık', labelKey: 'modSettings.options.enabled' }] }
    }
};export const OPTISCALER_SCHEMA = {
    Upscalers: {
        Dx11Upscaler: { type: 'dropdown', label: 'DX11 Upscaler', options: [
            { val: 'auto', label: 'Auto (fsr22)' },
            { val: 'fsr22', label: 'FSR 2.2 (Native DX11)' },
            { val: 'fsr31', label: 'FSR 3.1 (Native DX11)' },
            { val: 'xess', label: 'XeSS (Native DX11, Arc Only)' },
            { val: 'xess_12', label: 'XeSS (dx11on12)' },
            { val: 'fsr21_12', label: 'FSR 2.1 (dx11on12)' },
            { val: 'fsr22_12', label: 'FSR 2.2 (dx11on12)' },
            { val: 'fsr31_12', label: 'FSR 3.1 (dx11on12, FSR4)' },
            { val: 'dlss', label: 'DLSS' }
        ]},
        Dx12Upscaler: { type: 'dropdown', label: 'DX12 Upscaler', options: [
            { val: 'auto', label: 'Auto (xess)' },
            { val: 'xess', label: 'XeSS' },
            { val: 'fsr21', label: 'FSR 2.1' },
            { val: 'fsr22', label: 'FSR 2.2' },
            { val: 'fsr31', label: 'FSR 3.1 (FSR4)' },
            { val: 'dlss', label: 'DLSS' }
        ]},
        VulkanUpscaler: { type: 'dropdown', label: 'Vulkan Upscaler', options: [
            { val: 'auto', label: 'Auto (fsr22)' },
            { val: 'fsr21', label: 'FSR 2.1 (Native VK)' },
            { val: 'fsr22', label: 'FSR 2.2 (Native VK)' },
            { val: 'fsr31', label: 'FSR 3.1 (Native VK)' },
            { val: 'xess', label: 'XeSS (Native VK)' },
            { val: 'fsr21_12', label: 'FSR 2.1 (VKon12)' },
            { val: 'fsr31_12', label: 'FSR 3.1 (VKon12, FSR4)' },
            { val: 'dlss', label: 'DLSS' }
        ]}
    },
    FrameGen: {
        Enabled: { type: 'dropdown', label: 'Enabled', options: [
            { val: 'auto', label: 'Auto (Kapalı)' },
            { val: 'true', label: 'Açık' },
            { val: 'false', label: 'Kapalı' }
        ]},
        FGInput: { type: 'dropdown', label: 'FG Input / Source', options: [
            { val: 'auto', label: 'Auto (nofg)' },
            { val: 'dlssg', label: 'DLSSG (Streamline v2)' },
            { val: 'nukems', label: 'nukems (FSR3 FG)' },
            { val: 'fsrfg', label: 'FSR FG' },
            { val: 'upscaler', label: 'Upscaler (Hudfix)' },
            { val: 'fsrfg30', label: 'FSR FG 3.0' },
            { val: 'nofg', label: 'No FG' }
        ]},
        FGOutput: { type: 'dropdown', label: 'FG Output', options: [
            { val: 'auto', label: 'Auto (nofg)' },
            { val: 'fsrfg', label: 'FSR FG' },
            { val: 'xefg', label: 'XeFG' },
            { val: 'nukems', label: 'nukems' },
            { val: 'nofg', label: 'No FG' }
        ]},
        FGType: { type: 'dropdown', label: 'FG Type', options: [
            { val: 'auto', label: 'Auto (nofg)' },
            { val: 'fsrfg', label: 'FSR FG' },
            { val: 'xefg', label: 'XeFG' },
            { val: 'nukems', label: 'nukems' },
            { val: 'nofg', label: 'No FG' }
        ]},
        DebugView: { type: 'dropdown', label: 'Debug View', options: [
            { val: 'auto', label: 'Auto (Kapalı)' },
            { val: 'true', label: 'Açık' },
            { val: 'false', label: 'Kapalı' }
        ]}
    },
    XeFG: {
        InterpolationCount: { type: 'dropdown', label: 'Interpolation Count (MFG)', options: [
            { val: 'auto', label: 'Auto (2X / 1)' },
            { val: 1, label: '2X (1)' },
            { val: 2, label: '3X (2)' },
            { val: 3, label: '4X (3)' }
        ]}
    },
    Framerate: {
        FramerateLimit: { type: 'text', label: 'Framerate Limit (Reflex)' }
    },
    Sharpness: {
        OverrideSharpness: { type: 'dropdown', label: 'Override Sharpness', options: [
            { val: 'auto', label: 'Auto (Kapalı)' },
            { val: 'true', label: 'Açık' },
            { val: 'false', label: 'Kapalı' }
        ]},
        Sharpness: { type: 'text', label: 'Sharpness Value (0.0 - 1.0)' }
    },
    CAS: {
        Enabled: { type: 'dropdown', label: 'Enabled (RCAS)', options: [
            { val: 'auto', label: 'Auto (Kapalı)' },
            { val: 'true', label: 'Açık' },
            { val: 'false', label: 'Kapalı' }
        ]},
        MotionSharpnessEnabled: { type: 'dropdown', label: 'Motion Sharpness Enabled', options: [
            { val: 'auto', label: 'Auto (Kapalı)' },
            { val: 'true', label: 'Açık' },
            { val: 'false', label: 'Kapalı' }
        ]},
        MotionSharpness: { type: 'text', label: 'Motion Sharpness (-1.3 to 1.3)' }
    },
    Log: {
        LogToFile: { type: 'dropdown', label: 'Log To File', options: [
            { val: 'auto', label: 'Auto (Kapalı)' },
            { val: 'true', label: 'Açık' },
            { val: 'false', label: 'Kapalı' }
        ]},
        LogLevel: { type: 'dropdown', label: 'Log Level', options: [
            { val: 'auto', label: 'Auto (0 / Trace)' },
            { val: 0, label: '0: Trace' },
            { val: 1, label: '1: Debug' },
            { val: 2, label: '2: Info' },
            { val: 3, label: '3: Warning' },
            { val: 4, label: '4: Error' }
        ]}
    },
    UpscaleRatio: {
        UpscaleRatioOverrideEnabled: { type: 'dropdown', label: 'Resolution Override Enabled', options: [
            { val: 'auto', label: 'Auto (Kapalı)' },
            { val: 'true', label: 'Açık' },
            { val: 'false', label: 'Kapalı' }
        ]},
        UpscaleRatioOverrideValue: { type: 'text', label: 'Resolution Override Value' }
    },
    Menu: {
        ShowFps: { type: 'dropdown', label: 'Show FPS', options: [
            { val: 'auto', label: 'Auto (Kapalı)' },
            { val: 'true', label: 'Açık' },
            { val: 'false', label: 'Kapalı' }
        ]},
        LightTheme: { type: 'dropdown', label: 'Light Theme', options: [
            { val: 'auto', label: 'Auto (Kapalı)' },
            { val: 'true', label: 'Açık' },
            { val: 'false', label: 'Kapalı' }
        ]},
        Scale: { type: 'text', label: 'Scale' },
        ShortcutKey: { type: 'text', label: 'Shortcut Key (Hex)' }
    },
    Hotfix: {
        CheckForUpdate: { type: 'dropdown', label: 'Check For Update', options: [
            { val: 'auto', label: 'Auto (Açık)' },
            { val: 'true', label: 'Açık' },
            { val: 'false', label: 'Kapalı' }
        ]}
    }
};

/**
 * OptiScaler INI'sinden yalnızca gösterilecek / düzenlenecek 4 key.
 * Format: { section: { key: { label, type, options[] } } }
 * Değerler ham olarak yazılır (auto, true, 0, 1 …).
 */
export const OPTISCALER_FOCUSED_KEYS = {
    Plugins: {
        LoadAsiPlugins: {
            label: 'ASI Eklentiler (LoadAsiPlugins)',
            labelKey: 'modSettings.labels.loadAsiPlugins',
            type: 'dropdown',
            options: [
                { val: 'auto', label: 'Kapalı (Varsayılan)', labelKey: 'modSettings.options.disabledDefault' },
                { val: 'true', label: 'Açık', labelKey: 'modSettings.options.enabled' }
            ]
        }
    },
    Menu: {
        ShowFps: {
            label: 'FPS Göster (ShowFps)',
            labelKey: 'modSettings.labels.showFps',
            type: 'dropdown',
            options: [
                { val: 'auto', label: 'Kapalı (Varsayılan)', labelKey: 'modSettings.options.disabledDefault' },
                { val: 'true', label: 'Açık', labelKey: 'modSettings.options.enabled' }
            ]
        },
        FpsOverlayPos: {
            label: 'FPS Pozisyonu (FpsOverlayPos)',
            labelKey: 'modSettings.labels.fpsOverlayPos',
            type: 'dropdown',
            options: [
                { val: 'auto', label: 'Varsayılan', labelKey: 'modSettings.options.default' },
                { val: '0',    label: 'Sol Üst', labelKey: 'modSettings.options.topLeft' },
                { val: '1',    label: 'Sağ Üst', labelKey: 'modSettings.options.topRight' },
                { val: '2',    label: 'Sol Alt', labelKey: 'modSettings.options.bottomLeft' },
                { val: '3',    label: 'Sağ Alt', labelKey: 'modSettings.options.bottomRight' }
            ]
        },
        FpsOverlayType: {
            label: 'FPS Tipi (FpsOverlayType)',
            labelKey: 'modSettings.labels.fpsOverlayType',
            type: 'dropdown',
            options: [
                { val: 'auto', label: 'Varsayılan', labelKey: 'modSettings.options.default' },
                { val: '0',    label: 'Sadece FPS', labelKey: 'modSettings.options.fpsOnly' },
                { val: '1',    label: 'Basitleştirilmiş', labelKey: 'modSettings.options.simplified' },
                { val: '2',    label: 'Detaylı', labelKey: 'modSettings.options.detailed' },
                { val: '3',    label: 'Detaylı + Grafikli', labelKey: 'modSettings.options.detailedGraph' },
                { val: '4',    label: 'Full', labelKey: 'modSettings.options.full' },
                { val: '5',    label: 'Full + Grafikli', labelKey: 'modSettings.options.fullGraph' },
                { val: '6',    label: 'Reflex Zamanlamaları', labelKey: 'modSettings.options.reflexTimings' }
            ]
        }
    }
};

export const OPTISCALER_INSTALL_KEYS = {
    FrameGen: {
        Enabled: {
            label: 'Etkinleştirildi (Enabled)',
            labelKey: 'modSettings.labels.enabled',
            type: 'dropdown',
            options: [
                { val: 'true', label: 'Açık (True)', labelKey: 'modSettings.options.true' },
                { val: 'false', label: 'Kapalı (False)', labelKey: 'modSettings.options.false' }
            ]
        },
        FGInput: {
            label: 'FG Girdisi (FGInput)',
            labelKey: 'modSettings.labels.fgInput',
            type: 'dropdown',
            options: [
                { val: 'nofg', label: 'nofg' },
                { val: 'dlssg', label: 'dlssg' },
                { val: 'nukems', label: 'nukems' },
                { val: 'fsrfg', label: 'fsrfg' },
                { val: 'upscaler', label: 'upscaler' },
                { val: 'fsrfg30', label: 'fsrfg30' }
            ]
        },
        FGOutput: {
            label: 'FG Çıktısı (FGOutput)',
            labelKey: 'modSettings.labels.fgOutput',
            type: 'dropdown',
            options: [
                { val: 'nofg', label: 'nofg' },
                { val: 'fsrfg', label: 'fsrfg' },
                { val: 'xefg', label: 'xefg' },
                { val: 'nukems', label: 'nukems' }
            ]
        }
    },
    OptiFG: {
        HUDFix: {
            label: 'Arayüz Düzeltmesi (HUDFix)',
            labelKey: 'modSettings.labels.hudFix',
            type: 'dropdown',
            options: [
                { val: 'true', label: 'Açık (True)', labelKey: 'modSettings.options.true' },
                { val: 'false', label: 'Kapalı (False)', labelKey: 'modSettings.options.false' }
            ]
        }
    }
};
