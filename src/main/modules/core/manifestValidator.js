'use strict';

function validate(manifest) {
    const errors = [];
    const warnings = [];

    if (!manifest || typeof manifest !== 'object') {
        return { valid: false, errors: ['Manifest must be a JSON object.'], warnings: [] };
    }

    // Required fields
    const requiredKeys = ['id', 'name', 'source', 'install'];
    for (const key of requiredKeys) {
        if (!manifest[key]) {
            errors.push(`Gerekli alan eksik: '${key}'`);
        }
    }

    // Validate id
    if (manifest.id) {
        if (typeof manifest.id !== 'string' || manifest.id.trim() === '') {
            errors.push("'id' boş olmayan bir string olmalıdır.");
        } else if (!/^[a-z0-9-]+$/.test(manifest.id)) {
            errors.push("'id' sadece küçük harfler, rakamlar ve kısa çizgi (kebab-case) içerebilir.");
        }
    }

    // Validate name
    if (manifest.name && typeof manifest.name !== 'string') {
        errors.push("'name' string olmalıdır.");
    }

    // Validate source — 'github' (release tabanlı) veya 'url' (doğrudan indirme)
    if (manifest.source) {
        const sourceType = manifest.source.type || 'github';

        if (sourceType !== 'github' && sourceType !== 'url' && sourceType !== 'github_files') {
            errors.push("'source.type' 'github', 'github_files' veya 'url' olmalıdır.");
        }

        // github_files: release'de asset yok, dosyalar depodan tek tek cekilir
        if (sourceType === 'github_files') {
            if (!manifest.source.repo || typeof manifest.source.repo !== 'string' ||
                manifest.source.repo.split('/').filter(Boolean).length !== 2) {
                errors.push("'source.repo' 'owner/repo' formatında olmalıdır.");
            }
            const files = manifest.source.files;
            if (files !== undefined) {
                if (!Array.isArray(files) || !files.every(f => typeof f === 'string' && f.length > 0)) {
                    errors.push("'source.files' boş olmayan string dizisi olmalıdır.");
                }
            }
            // Indirilecek hic dosya yoksa kurulum anlamsiz: ya sabit dosya listesi
            // ya da hedefe gore kaynak esleme (proxyDetection.sourceByTarget) olmali
            const hasFiles = Array.isArray(files) && files.length > 0;
            const hasProxyMap = manifest.install && manifest.install.proxyDetection &&
                                manifest.install.proxyDetection.sourceByTarget;
            if (!hasFiles && !hasProxyMap) {
                errors.push("'github_files' kaynağı için 'source.files' ya da 'install.proxyDetection.sourceByTarget' gerekir.");
            }
        }

        if (sourceType === 'github') {
            if (!manifest.source.repo || typeof manifest.source.repo !== 'string' || !manifest.source.repo.includes('/')) {
                errors.push("'source.repo' 'owner/repo' formatında olmalıdır.");
            } else {
                const parts = manifest.source.repo.split('/');
                if (parts.length !== 2 || parts[0].length === 0 || parts[1].length === 0) {
                    errors.push("'source.repo' 'owner/repo' formatında olmalıdır.");
                }
            }
            // asset: tek glob ("*.zip") veya glob dizisi (["*.7z", "*.zip"]) olabilir
            const assetVal = manifest.source.asset;
            const assetValid =
                (typeof assetVal === 'string' && assetVal.length > 0) ||
                (Array.isArray(assetVal) && assetVal.length > 0 && assetVal.every(a => typeof a === 'string' && a.length > 0));
            if (!assetValid) {
                errors.push("'source.asset' string veya boş olmayan string dizisi olmalıdır.");
            }
        }

        if (sourceType === 'url') {
            if (!manifest.source.url || typeof manifest.source.url !== 'string' || !/^https?:\/\//i.test(manifest.source.url)) {
                errors.push("'source.url' http(s) ile başlayan bir adres olmalıdır.");
            }
            const vc = manifest.source.versionCheck;
            if (vc !== undefined) {
                if (typeof vc !== 'object' || Array.isArray(vc)) {
                    errors.push("'source.versionCheck' bir obje olmalıdır.");
                } else {
                    const validTypes = ['html_scrape', 'json_field', 'static'];
                    if (!vc.type || !validTypes.includes(vc.type)) {
                        errors.push(`'source.versionCheck.type' şunlardan biri olmalıdır: ${validTypes.join(', ')}`);
                    }
                    if (vc.type === 'html_scrape' && (!vc.url || !vc.pattern)) {
                        errors.push("'source.versionCheck' html_scrape için 'url' ve 'pattern' gerekir.");
                    }
                    if (vc.type === 'json_field' && (!vc.url || !vc.field)) {
                        errors.push("'source.versionCheck' json_field için 'url' ve 'field' gerekir.");
                    }
                }
            } else if (!manifest.source.version && manifest.source.url.includes('{version}')) {
                errors.push("'source.url' içinde {version} var ama 'versionCheck' veya 'source.version' tanımlı değil.");
            }
        }
    }

    // Validate install
    if (manifest.install) {
        if (!manifest.install.destination) {
            errors.push("Gerekli alan eksik: 'install.destination'");
        } else {
            const dest = manifest.install.destination;
            if (typeof dest === 'string') {
                if (dest !== 'game_root' && dest !== 'game_exe' && dest !== 'dynamic_search') {
                    errors.push("'install.destination' string ise 'game_root', 'game_exe' veya 'dynamic_search' olmalıdır.");
                }
            } else if (typeof dest === 'object' && !Array.isArray(dest)) {
                if (dest.type !== 'relative' || typeof dest.path !== 'string') {
                    errors.push("Obje olarak belirtilen 'install.destination' { type: 'relative', path: '...' } şeklinde olmalıdır.");
                }
            } else {
                errors.push("'install.destination' geçerli bir string veya obje olmalıdır.");
            }
        }

        // Validate detection if present
        if (manifest.install.detection) {
            const det = manifest.install.detection;
            if (typeof det !== 'object' || Array.isArray(det)) {
                errors.push("'install.detection' bir obje olmalıdır.");
            } else {
                if (det.files && (!Array.isArray(det.files) || det.files.length === 0)) {
                    errors.push("'install.detection.files' boş olmayan bir string dizisi olmalıdır.");
                }
                if (det.strategy && typeof det.strategy !== 'string') {
                    errors.push("'install.detection.strategy' string olmalıdır.");
                }
                if (det.fallback && typeof det.fallback !== 'string') {
                    errors.push("'install.detection.fallback' string olmalıdır.");
                }
                if (det.allowManualPicker !== undefined && typeof det.allowManualPicker !== 'boolean') {
                    errors.push("'install.detection.allowManualPicker' boolean olmalıdır.");
                }
                if (det.searchBase && det.searchBase !== 'game_root' && det.searchBase !== 'game_exe') {
                    errors.push("'install.detection.searchBase' 'game_root' veya 'game_exe' olmalıdır.");
                }
            }
        }

        // Validate whitelistFiles if present
        if (manifest.install.whitelistFiles !== undefined) {
            if (!Array.isArray(manifest.install.whitelistFiles)) {
                errors.push("'install.whitelistFiles' bir dizi (array) olmalıdır.");
            }
        }

        // Validate extractRoot if present
        if (manifest.install.extractRoot !== undefined && typeof manifest.install.extractRoot !== 'string') {
            errors.push("'install.extractRoot' string olmalıdır.");
        }

        // Validate refreshGameOnComplete if present
        if (manifest.install.refreshGameOnComplete !== undefined && typeof manifest.install.refreshGameOnComplete !== 'boolean') {
            errors.push("'install.refreshGameOnComplete' boolean olmalıdır.");
        }

        // Validate proxyDetection if present
        if (manifest.install.proxyDetection) {
            const pd = manifest.install.proxyDetection;
            if (typeof pd !== 'object' || Array.isArray(pd)) {
                errors.push("'install.proxyDetection' bir obje olmalıdır.");
            } else {
                if (!pd.sourceFile || typeof pd.sourceFile !== 'string') {
                    errors.push("'install.proxyDetection.sourceFile' string olmalıdır.");
                }
                if (!Array.isArray(pd.candidates) || pd.candidates.length === 0) {
                    errors.push("'install.proxyDetection.candidates' boş olmayan bir string dizisi olmalıdır.");
                }
                // sourceByTarget: her hedef adin KENDI binary'si var (yeniden
                // adlandirma yok). Boyle modullerde DLL'de surum kaynagi
                // bulunmayabilir, o yuzden descriptionMatch zorunlu degildir.
                if (pd.sourceByTarget !== undefined) {
                    if (typeof pd.sourceByTarget !== 'object' || Array.isArray(pd.sourceByTarget)) {
                        errors.push("'install.proxyDetection.sourceByTarget' bir obje olmalıdır.");
                    } else {
                        const cands = Array.isArray(pd.candidates) ? pd.candidates : [];
                        for (const cand of cands) {
                            if (!pd.sourceByTarget[cand]) {
                                errors.push(`'install.proxyDetection.sourceByTarget' '${cand}' için kaynak yol içermiyor.`);
                            }
                        }
                    }
                } else if (!pd.descriptionMatch || typeof pd.descriptionMatch !== 'string') {
                    errors.push("'install.proxyDetection.descriptionMatch' string olmalıdır.");
                }
                if (!pd.defaultTarget || typeof pd.defaultTarget !== 'string') {
                    errors.push("'install.proxyDetection.defaultTarget' string olmalıdır.");
                }
            }
        }

        // Validate verifyAntiVirusDelayMs if present
        if (manifest.install.verifyAntiVirusDelayMs !== undefined) {
            if (typeof manifest.install.verifyAntiVirusDelayMs !== 'number' || manifest.install.verifyAntiVirusDelayMs < 0) {
                errors.push("'install.verifyAntiVirusDelayMs' pozitif bir sayı olmalıdır.");
            }
        }

        // Validate cleanStaleVersionFiles if present
        if (manifest.install.cleanStaleVersionFiles !== undefined) {
            if (typeof manifest.install.cleanStaleVersionFiles !== 'boolean') {
                errors.push("'install.cleanStaleVersionFiles' boolean olmalıdır.");
            }
        }

        // Validate apiTargeting — oyunun grafik API'sine göre dosya seçimi/yeniden adlandırma
        if (manifest.install.apiTargeting !== undefined) {
            const at = manifest.install.apiTargeting;
            if (typeof at !== 'object' || Array.isArray(at)) {
                errors.push("'install.apiTargeting' bir obje olmalıdır.");
            } else {
                if (!at.sourceByArch || typeof at.sourceByArch !== 'object') {
                    errors.push("'install.apiTargeting.sourceByArch' { x64, x86 } şeklinde olmalıdır.");
                } else if (!at.sourceByArch.x64 && !at.sourceByArch.x86) {
                    errors.push("'install.apiTargeting.sourceByArch' en az bir mimari (x64 veya x86) içermelidir.");
                }
                if (at.renameByApi !== undefined && (typeof at.renameByApi !== 'object' || Array.isArray(at.renameByApi))) {
                    errors.push("'install.apiTargeting.renameByApi' bir obje olmalıdır (api → dosya adı).");
                }
                if (at.defaultApi !== undefined && typeof at.defaultApi !== 'string') {
                    errors.push("'install.apiTargeting.defaultApi' string olmalıdır ('auto' veya api adı).");
                }
                if (at.allowUserOverride !== undefined && typeof at.allowUserOverride !== 'boolean') {
                    errors.push("'install.apiTargeting.allowUserOverride' boolean olmalıdır.");
                }
            }
        }

        // Validate extraSources — ana arşivden bağımsız ek indirmeler
        if (manifest.install.extraSources !== undefined) {
            if (!Array.isArray(manifest.install.extraSources)) {
                errors.push("'install.extraSources' bir dizi olmalıdır.");
            } else {
                manifest.install.extraSources.forEach((extra, idx) => {
                    if (typeof extra !== 'object' || Array.isArray(extra)) {
                        errors.push(`'install.extraSources[${idx}]' bir obje olmalıdır.`);
                        return;
                    }
                    if (!extra.url || !/^https?:\/\//i.test(extra.url)) {
                        errors.push(`'install.extraSources[${idx}].url' http(s) adresi olmalıdır.`);
                    }
                    if (extra.extractTo !== undefined && typeof extra.extractTo !== 'string') {
                        errors.push(`'install.extraSources[${idx}].extractTo' string olmalıdır.`);
                    }
                    if (extra.include !== undefined && !Array.isArray(extra.include)) {
                        errors.push(`'install.extraSources[${idx}].include' bir dizi olmalıdır.`);
                    }
                });
            }
        }

        // Validate applyPresetOnInstall if present
        if (manifest.install.applyPresetOnInstall !== undefined) {
            if (typeof manifest.install.applyPresetOnInstall !== 'string' && typeof manifest.install.applyPresetOnInstall !== 'boolean') {
                errors.push("'install.applyPresetOnInstall' string veya boolean olmalıdır.");
            }
        }
    }

    // Validate root applyPresetOnInstall if present
    if (manifest.applyPresetOnInstall !== undefined) {
        if (typeof manifest.applyPresetOnInstall !== 'string' && typeof manifest.applyPresetOnInstall !== 'boolean') {
            errors.push("'applyPresetOnInstall' string veya boolean olmalıdır.");
        }
    }

    // Validate config
    if (manifest.config) {
        if (!Array.isArray(manifest.config)) {
            errors.push("'config' bir dizi (array) olmalıdır.");
        } else {
            manifest.config.forEach((cfg, idx) => {
                if (!cfg.file || typeof cfg.file !== 'string') {
                    errors.push(`'config[${idx}].file' string olarak belirtilmelidir.`);
                }
                if (cfg.format !== 'ini' && cfg.format !== 'json') {
                    errors.push(`'config[${idx}].format' 'ini' veya 'json' olmalıdır.`);
                }
                if (cfg.set !== undefined && (typeof cfg.set !== 'object' || Array.isArray(cfg.set))) {
                    errors.push(`'config[${idx}].set' geçerli bir ayar objesi olmalıdır.`);
                }
                if (!cfg.set && !cfg.schema) {
                    errors.push(`'config[${idx}]' için 'set' veya 'schema' alanlarından en az biri tanımlanmalıdır.`);
                }

                // Validate config schema
                if (cfg.schema !== undefined) {
                    if (typeof cfg.schema !== 'object' || Array.isArray(cfg.schema)) {
                        errors.push(`'config[${idx}].schema' bir obje olmalıdır.`);
                    } else {
                        for (const [secName, secObj] of Object.entries(cfg.schema)) {
                            if (typeof secObj !== 'object' || Array.isArray(secObj)) {
                                errors.push(`'config[${idx}].schema.${secName}' bir bölüm (section) objesi olmalıdır.`);
                                continue;
                            }
                            if (secObj.visibleIf !== undefined) {
                                if (typeof secObj.visibleIf !== 'object' || !secObj.visibleIf.flag) {
                                    errors.push(`'config[${idx}].schema.${secName}.visibleIf' geçerli bir koşul ({ flag, value }) olmalıdır.`);
                                }
                            }
                            for (const [keyName, keyDef] of Object.entries(secObj)) {
                                if (keyName === 'visibleIf') continue;
                                if (typeof keyDef !== 'object' || Array.isArray(keyDef)) {
                                    errors.push(`'config[${idx}].schema.${secName}.${keyName}' bir ayar tanım objesi olmalıdır.`);
                                    continue;
                                }
                                const validTypes = ['toggle', 'dropdown', 'slider', 'text'];
                                if (!keyDef.type || !validTypes.includes(keyDef.type)) {
                                    errors.push(`'config[${idx}].schema.${secName}.${keyName}.type' geçerli bir tip (${validTypes.join(', ')}) olmalıdır.`);
                                }
                                if (keyDef.visibleIf !== undefined) {
                                    if (typeof keyDef.visibleIf !== 'object' || !keyDef.visibleIf.flag) {
                                        errors.push(`'config[${idx}].schema.${secName}.${keyName}.visibleIf' geçerli bir koşul ({ flag, value }) olmalıdır.`);
                                    }
                                }
                            }
                        }
                    }
                }

                // Validate config presets
                if (cfg.presets !== undefined) {
                    if (typeof cfg.presets !== 'object' || Array.isArray(cfg.presets)) {
                        errors.push(`'config[${idx}].presets' bir obje olmalıdır.`);
                    } else {
                        for (const [pId, pObj] of Object.entries(cfg.presets)) {
                            if (typeof pObj !== 'object' || Array.isArray(pObj) || !pObj.values || typeof pObj.values !== 'object') {
                                errors.push(`'config[${idx}].presets.${pId}' geçerli bir 'values' objesi içermelidir.`);
                            }
                        }
                    }
                }
            });
        }
    }

    // Validate conditions
    if (manifest.conditions) {
        if (!Array.isArray(manifest.conditions)) {
            errors.push("'conditions' bir dizi (array) olmalıdır.");
        } else {
            manifest.conditions.forEach((cond, idx) => {
                if (!cond.type || typeof cond.type !== 'string') {
                    errors.push(`'conditions[${idx}].type' string olarak belirtilmelidir.`);
                }
                if (cond.enabled !== undefined && typeof cond.enabled !== 'boolean') {
                    errors.push(`'conditions[${idx}].enabled' boolean olmalıdır.`);
                }
            });
        }
    }

    // Validate detect — diskte mod tespiti (scanner tarafından kullanılır)
    if (manifest.detect !== undefined) {
        const det = manifest.detect;
        if (typeof det !== 'object' || Array.isArray(det)) {
            errors.push("'detect' bir obje olmalıdır.");
        } else {
            if (det.priority !== undefined && typeof det.priority !== 'number') {
                errors.push("'detect.priority' sayı olmalıdır.");
            }
            if (det.enabled !== undefined && typeof det.enabled !== 'boolean') {
                errors.push("'detect.enabled' boolean olmalıdır.");
            }
            if (det.sticky !== undefined && typeof det.sticky !== 'boolean') {
                errors.push("'detect.sticky' boolean olmalıdır.");
            }
            if (det.exclusiveGroup !== undefined && typeof det.exclusiveGroup !== 'string') {
                errors.push("'detect.exclusiveGroup' string olmalıdır.");
            }
            if (det.depthStrategy !== undefined && det.depthStrategy !== 'shallowest' && det.depthStrategy !== 'deepest') {
                errors.push("'detect.depthStrategy' 'shallowest' veya 'deepest' olmalıdır.");
            }

            const m = det.match;
            if (!m || typeof m !== 'object' || Array.isArray(m)) {
                errors.push("'detect.match' bir obje olmalıdır.");
            } else {
                const hasNameRule = Array.isArray(m.anyFileName) || typeof m.fileNamePattern === 'string' || (m.proxyDll && typeof m.proxyDll === 'object');
                if (!hasNameRule) {
                    errors.push("'detect.match' içinde 'anyFileName', 'fileNamePattern' veya 'proxyDll' kurallarından en az biri bulunmalıdır.");
                }
                if (m.anyFileName !== undefined) {
                    if (!Array.isArray(m.anyFileName) || !m.anyFileName.every(n => typeof n === 'string' && n.length > 0)) {
                        errors.push("'detect.match.anyFileName' boş olmayan string dizisi olmalıdır.");
                    }
                }
                if (m.fileNamePattern !== undefined && typeof m.fileNamePattern !== 'string') {
                    errors.push("'detect.match.fileNamePattern' string olmalıdır.");
                }
                if (m.proxyDll !== undefined) {
                    const pd = m.proxyDll;
                    if (typeof pd !== 'object' || Array.isArray(pd)) {
                        errors.push("'detect.match.proxyDll' bir obje olmalıdır.");
                    } else {
                        if (!Array.isArray(pd.candidates) || pd.candidates.length === 0) {
                            errors.push("'detect.match.proxyDll.candidates' boş olmayan bir string dizisi olmalıdır.");
                        } else if (pd.candidates.some(c => typeof c !== 'string' || c.includes('*'))) {
                            // Joker isim tüm taramayı yavaşlatır — her dosyada FileDescription okunur
                            errors.push("'detect.match.proxyDll.candidates' joker (*) içeremez, tam dosya adları olmalıdır.");
                        }
                        if (!pd.descriptionMatch || typeof pd.descriptionMatch !== 'string') {
                            errors.push("'detect.match.proxyDll.descriptionMatch' string olmalıdır.");
                        }
                    }
                }
                if (m.requireSiblingFile !== undefined && typeof m.requireSiblingFile !== 'string') {
                    errors.push("'detect.match.requireSiblingFile' string olmalıdır.");
                }
                if (m.versionRange !== undefined) {
                    const vr = m.versionRange;
                    if (typeof vr !== 'object' || Array.isArray(vr)) {
                        errors.push("'detect.match.versionRange' bir obje olmalıdır.");
                    } else {
                        if (vr.min === undefined && vr.max === undefined) {
                            errors.push("'detect.match.versionRange' en az 'min' veya 'max' içermelidir.");
                        }
                        if (vr.min !== undefined && typeof vr.min !== 'string') {
                            errors.push("'detect.match.versionRange.min' string olmalıdır.");
                        }
                        if (vr.max !== undefined && typeof vr.max !== 'string') {
                            errors.push("'detect.match.versionRange.max' string olmalıdır.");
                        }
                        if (vr.allowUnknown !== undefined && typeof vr.allowUnknown !== 'boolean') {
                            errors.push("'detect.match.versionRange.allowUnknown' boolean olmalıdır.");
                        }
                    }
                }
            }

            // detect varsa state olmadan bir işe yaramaz — tespit sonucu yazılacak alan yok
            if (!manifest.state || !manifest.state.flag) {
                warnings.push("'detect' tanımlı ama 'state.flag' yok — tespit sonucu hiçbir alana yazılamaz.");
            }
        }
    }

    // Validate backup
    if (manifest.backup) {
        if (typeof manifest.backup !== 'object' || Array.isArray(manifest.backup)) {
            errors.push("'backup' bir obje olmalıdır.");
        } else {
            if (manifest.backup.enabled !== undefined && typeof manifest.backup.enabled !== 'boolean') {
                errors.push("'backup.enabled' boolean olmalıdır.");
            }
            if (manifest.backup.strategy && typeof manifest.backup.strategy !== 'string') {
                errors.push("'backup.strategy' string olmalıdır ('folder', 'in_place_suffix' vb.).");
            }
            if (manifest.backup.suffix && typeof manifest.backup.suffix !== 'string') {
                errors.push("'backup.suffix' string olmalıdır (örn: '.backup').");
            }
            if (manifest.backup.recordHashes !== undefined && typeof manifest.backup.recordHashes !== 'boolean') {
                errors.push("'backup.recordHashes' boolean olmalıdır.");
            }
            if (manifest.backup.rollbackOnFailure !== undefined && typeof manifest.backup.rollbackOnFailure !== 'boolean') {
                errors.push("'backup.rollbackOnFailure' boolean olmalıdır.");
            }
        }
    }

    // Validate uninstall
    if (manifest.uninstall) {
        if (typeof manifest.uninstall !== 'object' || Array.isArray(manifest.uninstall)) {
            errors.push("'uninstall' bir obje olmalıdır.");
        } else {
            if (manifest.uninstall.files && !Array.isArray(manifest.uninstall.files)) {
                errors.push("'uninstall.files' bir dizi (array) olmalıdır.");
            }
            if (manifest.uninstall.strategy && typeof manifest.uninstall.strategy !== 'string') {
                errors.push("'uninstall.strategy' string olmalıdır.");
            }
            if (manifest.uninstall.suffix && typeof manifest.uninstall.suffix !== 'string') {
                errors.push("'uninstall.suffix' string olmalıdır.");
            }
            if (manifest.uninstall.gameUpdatedCheck !== undefined && typeof manifest.uninstall.gameUpdatedCheck !== 'boolean') {
                errors.push("'uninstall.gameUpdatedCheck' boolean olmalıdır.");
            }
            if (manifest.uninstall.cleanModOnlyFiles !== undefined && typeof manifest.uninstall.cleanModOnlyFiles !== 'boolean') {
                errors.push("'uninstall.cleanModOnlyFiles' boolean olmalıdır.");
            }
            if (manifest.uninstall.verifiedDlls) {
                if (!Array.isArray(manifest.uninstall.verifiedDlls)) {
                    errors.push("'uninstall.verifiedDlls' bir dizi (array) olmalıdır.");
                } else {
                    manifest.uninstall.verifiedDlls.forEach((vd, idx) => {
                        if (!Array.isArray(vd.candidates) || vd.candidates.length === 0) {
                            errors.push(`'uninstall.verifiedDlls[${idx}].candidates' string dizisi olmalıdır.`);
                        }
                        // matchModFileHash: DLL'de FileDescription yoksa sahiplik
                        // indirilmis mod dosyasinin hash'iyle kanitlanir
                        if (vd.matchModFileHash !== undefined && typeof vd.matchModFileHash !== 'boolean') {
                            errors.push(`'uninstall.verifiedDlls[${idx}].matchModFileHash' boolean olmalıdır.`);
                        }
                        if (vd.matchModFileHash !== true &&
                            (!vd.descriptionMatch || typeof vd.descriptionMatch !== 'string')) {
                            errors.push(`'uninstall.verifiedDlls[${idx}].descriptionMatch' string olmalıdır.`);
                        }
                    });
                }
            }
            if (manifest.uninstall.restoreBackup !== undefined && typeof manifest.uninstall.restoreBackup !== 'boolean') {
                errors.push("'uninstall.restoreBackup' boolean olmalıdır.");
            }
        }
    }

    // Validate wizard
    if (manifest.wizard) {
        if (typeof manifest.wizard !== 'object' || Array.isArray(manifest.wizard)) {
            errors.push("'wizard' bir obje olmalıdır.");
        } else {
            const wiz = manifest.wizard;
            if (!wiz.type || (wiz.type !== 'auto_test' && wiz.type !== 'guided_install')) {
                errors.push("'wizard.type' 'auto_test' veya 'guided_install' olmalıdır.");
            }
            if (wiz.title && typeof wiz.title !== 'string') {
                errors.push("'wizard.title' string olmalıdır.");
            }
            if (wiz.description && typeof wiz.description !== 'string') {
                errors.push("'wizard.description' string olmalıdır.");
            }
            if (wiz.applyPresetOnSuccess && typeof wiz.applyPresetOnSuccess !== 'string') {
                errors.push("'wizard.applyPresetOnSuccess' string olmalıdır.");
            }

            // auto_test type validations
            if (wiz.type === 'auto_test') {
                if (!wiz.autoTest || typeof wiz.autoTest !== 'object' || Array.isArray(wiz.autoTest)) {
                    errors.push("'wizard.autoTest' bir obje olmalıdır.");
                } else {
                    const at = wiz.autoTest;
                    if (!at.sourceFile || typeof at.sourceFile !== 'string') {
                        errors.push("'wizard.autoTest.sourceFile' string olmalıdır.");
                    }
                    if (!Array.isArray(at.candidates) || at.candidates.length === 0) {
                        errors.push("'wizard.autoTest.candidates' boş olmayan bir string dizisi olmalıdır.");
                    }
                    if (!at.watchFile || typeof at.watchFile !== 'string') {
                        errors.push("'wizard.autoTest.watchFile' string olmalıdır.");
                    }
                    if (at.timeoutSeconds !== undefined && (typeof at.timeoutSeconds !== 'number' || at.timeoutSeconds <= 0)) {
                        errors.push("'wizard.autoTest.timeoutSeconds' pozitif bir sayı olmalıdır.");
                    }
                    if (at.watchLocation !== undefined && at.watchLocation !== 'game_exe' && at.watchLocation !== 'game_root') {
                        errors.push("'wizard.autoTest.watchLocation' 'game_exe' veya 'game_root' olmalıdır.");
                    }
                    if (at.checkProcessRunning !== undefined && typeof at.checkProcessRunning !== 'boolean') {
                        errors.push("'wizard.autoTest.checkProcessRunning' boolean olmalıdır.");
                    }
                    if (at.autoTerminateGame !== undefined && typeof at.autoTerminateGame !== 'boolean') {
                        errors.push("'wizard.autoTest.autoTerminateGame' boolean olmalıdır.");
                    }
                }
            }
        }
    }

    // Unknown keys warnings
    const allowedKeys = [
        'id', 'name', 'source', 'install', 'description', 'author', 'version',
        'minVManagerVersion', 'config', 'conditions', 'backup', 'state',
        'uninstall', 'permissions', 'metadata', 'wizard',
        // 'role': "mod" (varsayılan) | "addon" (listede gizli) | "both" (hem tek başına kurulur hem eklenti olabilir)
        // 'addons': başka modül id'lerini referans alan opsiyonel eklentiler
        // 'detect': diskte bu modun nasıl tanınacağı (scanner mod tespiti)
        // 'requires': bu mod kurulmadan önce kurulu olması gereken modüller
        // 'conflicts' / 'incompatible_mods': bu modla aynı anda duramayacak modüller
        'role', 'addons', 'aliases', 'detect', 'requires', 'conflicts', 'incompatible_mods'
    ];

    for (const key of Object.keys(manifest)) {
        if (!allowedKeys.includes(key)) {
            warnings.push(`Bilinmeyen anahtar tespit edildi: '${key}'`);
        }
    }

    // aliases doğrulaması — eski id'ler (geriye dönük arama için)
    if (manifest.aliases !== undefined) {
        if (!Array.isArray(manifest.aliases) || !manifest.aliases.every(a => typeof a === 'string' && a.length > 0)) {
            errors.push("'aliases' boş olmayan string dizisi olmalıdır.");
        }
    }

    // role doğrulaması
    if (manifest.role !== undefined && !['mod', 'addon', 'both'].includes(manifest.role)) {
        errors.push("'role' yalnızca 'mod', 'addon' veya 'both' olabilir.");
    }

    // addons doğrulaması — her girdi var olan bir modül id'sini referans almalıdır
    if (manifest.addons !== undefined) {
        if (!Array.isArray(manifest.addons)) {
            errors.push("'addons' bir dizi olmalıdır.");
        } else {
            manifest.addons.forEach((a, i) => {
                if (!a || typeof a !== 'object') {
                    errors.push(`'addons[${i}]' bir nesne olmalıdır.`);
                    return;
                }
                if (!a.moduleId || typeof a.moduleId !== 'string') {
                    errors.push(`'addons[${i}].moduleId' zorunludur (referans modül id'si).`);
                }
                if (a.install && typeof a.install !== 'object') {
                    errors.push(`'addons[${i}].install' bir nesne olmalıdır.`);
                }
                if (a.configChanges && typeof a.configChanges !== 'object') {
                    errors.push(`'addons[${i}].configChanges' bir nesne olmalıdır.`);
                }
            });
        }
    }

    // requires doğrulaması — kurulum öncesi zorunlu olan diğer modüller
    if (manifest.requires !== undefined) {
        if (!Array.isArray(manifest.requires)) {
            errors.push("'requires' bir dizi olmalıdır.");
        } else {
            const addonIds = Array.isArray(manifest.addons)
                ? manifest.addons.map(a => a && a.moduleId).filter(Boolean)
                : [];

            manifest.requires.forEach((r, i) => {
                if (!r || typeof r !== 'object') {
                    errors.push(`'requires[${i}]' bir nesne olmalıdır.`);
                    return;
                }
                if (!r.moduleId || typeof r.moduleId !== 'string') {
                    errors.push(`'requires[${i}].moduleId' zorunludur (gerekli modülün id'si).`);
                    return;
                }
                if (r.moduleId === manifest.id) {
                    errors.push(`'requires[${i}].moduleId' modülün kendisini referans alamaz.`);
                }
                if (addonIds.includes(r.moduleId)) {
                    errors.push(`'${r.moduleId}' hem 'requires' hem 'addons' içinde — bir modül aynı anda hem zorunlu ön koşul hem opsiyonel eklenti olamaz.`);
                }
                if (r.severity !== undefined && !['block', 'warn'].includes(r.severity)) {
                    errors.push(`'requires[${i}].severity' yalnızca 'block' veya 'warn' olabilir.`);
                }
                if (r.message !== undefined && typeof r.message !== 'string') {
                    errors.push(`'requires[${i}].message' string olmalıdır.`);
                }
                if (r.messageKey !== undefined && typeof r.messageKey !== 'string') {
                    errors.push(`'requires[${i}].messageKey' string olmalıdır.`);
                }
                if (r.enabled !== undefined && typeof r.enabled !== 'boolean') {
                    errors.push(`'requires[${i}].enabled' boolean olmalıdır.`);
                }
            });
        }
    }

    // conflicts doğrulaması — bu modla aynı anda duramayacak modüller.
    // 'incompatible_mods' aynı şemanın takma adı; string dizisi de kabul edilir.
    // Alan hiç yoksa hiçbir kural işlemez (geriye dönük uyumlu).
    const conflictKey = manifest.conflicts !== undefined
        ? 'conflicts'
        : (manifest.incompatible_mods !== undefined ? 'incompatible_mods' : null);

    if (conflictKey) {
        if (manifest.conflicts !== undefined && manifest.incompatible_mods !== undefined) {
            warnings.push("'conflicts' ve 'incompatible_mods' birlikte tanımlanmış; yalnızca 'conflicts' okunur.");
        }

        const rawConflicts = manifest[conflictKey];
        if (!Array.isArray(rawConflicts)) {
            errors.push(`'${conflictKey}' bir dizi olmalıdır.`);
        } else {
            const requiredIds = Array.isArray(manifest.requires)
                ? manifest.requires.map(r => r && r.moduleId).filter(Boolean)
                : [];

            rawConflicts.forEach((c, i) => {
                let moduleId = null;

                if (typeof c === 'string') {
                    moduleId = c;
                } else if (c && typeof c === 'object') {
                    moduleId = c.moduleId;
                    if (!moduleId || typeof moduleId !== 'string') {
                        errors.push(`'${conflictKey}[${i}].moduleId' zorunludur (çakışan modülün id'si).`);
                        return;
                    }
                    if (c.severity !== undefined && !['block', 'warn'].includes(c.severity)) {
                        errors.push(`'${conflictKey}[${i}].severity' yalnızca 'block' veya 'warn' olabilir.`);
                    }
                    if (c.message !== undefined && typeof c.message !== 'string') {
                        errors.push(`'${conflictKey}[${i}].message' string olmalıdır.`);
                    }
                    if (c.messageKey !== undefined && typeof c.messageKey !== 'string') {
                        errors.push(`'${conflictKey}[${i}].messageKey' string olmalıdır.`);
                    }
                    if (c.enabled !== undefined && typeof c.enabled !== 'boolean') {
                        errors.push(`'${conflictKey}[${i}].enabled' boolean olmalıdır.`);
                    }
                } else {
                    errors.push(`'${conflictKey}[${i}]' string ya da nesne olmalıdır.`);
                    return;
                }

                if (moduleId === manifest.id) {
                    errors.push(`'${conflictKey}[${i}].moduleId' modülün kendisini referans alamaz.`);
                }
                if (requiredIds.includes(moduleId)) {
                    errors.push(`'${moduleId}' hem 'requires' hem '${conflictKey}' içinde — bir modül aynı anda hem zorunlu ön koşul hem çakışan olamaz.`);
                }
            });
        }
    }

    if (errors.length > 0) {
        console.error('[MANIFEST_VALIDATOR] Validasyon hataları bulundu:', errors);
    }

    return {
        valid: errors.length === 0,
        errors,
        warnings
    };
}

module.exports = {
    validate
};
