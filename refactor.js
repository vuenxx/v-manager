const fs = require('fs');
const path = require('path');

const indexHtmlPath = path.join(__dirname, 'index.html');
let indexHtml = fs.readFileSync(indexHtmlPath, 'utf8');

// 1. Remove uninstall modals
const uninstallStartStr = '    <!-- Uninstall Mod Selection Modal -->';
const dlssConfirmStartStr = '    <!-- DLSS Install Confirm Modal -->';

const uninstallStartIndex = indexHtml.indexOf(uninstallStartStr);
const dlssConfirmStartIndex = indexHtml.indexOf(dlssConfirmStartStr);

if (uninstallStartIndex !== -1 && dlssConfirmStartIndex !== -1) {
    indexHtml = indexHtml.substring(0, uninstallStartIndex) + indexHtml.substring(dlssConfirmStartIndex);
}

// 2. Rename manage-modal to update-modal in index.html
// Let's find the manage-modal block and replace its IDs
const manageModalStartStr = '    <!-- Manage Modal -->';
const scriptTagStr = '    <script type="module" src="renderer.js"></script>';

const manageModalStartIndex = indexHtml.indexOf(manageModalStartStr);
const scriptTagIndex = indexHtml.indexOf(scriptTagStr);

if (manageModalStartIndex !== -1 && scriptTagIndex !== -1) {
    let beforeManage = indexHtml.substring(0, manageModalStartIndex);
    let manageBlock = indexHtml.substring(manageModalStartIndex, scriptTagIndex);
    let afterManage = indexHtml.substring(scriptTagIndex);

    // Replace manage block
    manageBlock = manageBlock.replace(/<!-- Manage Modal -->/g, '<!-- Update Modal -->');
    manageBlock = manageBlock.replace(/id="manage-modal"/g, 'id="update-modal"');
    manageBlock = manageBlock.replace(/data-target="manage-modal"/g, 'data-target="update-modal"');
    manageBlock = manageBlock.replace(/Mod Yönetimi/g, 'Mod Güncelleme');
    manageBlock = manageBlock.replace(/id="manage-/g, 'id="update-');

    // Create Settings Modal Block
    const settingsModalHtml = `
    <!-- Settings Modal -->
    <div id="settings-modal" class="modal">
        <div class="modal-content large-modal">
            <span class="close-modal" data-target="settings-modal">&times;</span>
            <div class="dlss-modal-body">
                <!-- Left Side: Cover & Tabs -->
                <div class="dlss-modal-left">
                    <div class="dlss-cover-wrapper">
                        <img id="settings-game-cover" src="" alt="" class="dlss-game-img">
                        <div id="settings-game-placeholder" class="dlss-placeholder" style="display:none;">🎮</div>
                    </div>
                    <div id="settings-game-name" class="dlss-game-title"></div>
                    
                    <!-- Tabs -->
                    <div style="margin-top: 20px; display: flex; flex-direction: column; gap: 8px;">
                        <button id="tab-dlss-enabler" class="install-btn" style="background: rgba(139, 92, 246, 0.2); border: 1px solid rgba(139, 92, 246, 0.4); color: white; display: none;">DLSS Enabler</button>
                        <button id="tab-optiscaler" class="install-btn" style="background: rgba(245, 158, 11, 0.2); border: 1px solid rgba(245, 158, 11, 0.4); color: white; display: none;">OptiScaler</button>
                    </div>
                </div>

                <!-- Right Side: Settings -->
                <div class="dlss-modal-right" style="display: flex; flex-direction: column;">
                    <div style="display: flex; justify-content: space-between; align-items: center;">
                        <h2 class="dlss-modal-title" style="margin: 0;">Mod Ayarları (INI Editörü)</h2>
                        <button id="settings-save-btn" class="install-btn" style="width: auto; padding: 8px 24px; margin: 0; background-color: #3b82f6;">Kaydet</button>
                    </div>
                    
                    <div id="settings-warning-banner" style="margin-top: 15px; background: rgba(239, 68, 68, 0.15); border-left: 4px solid #ef4444; padding: 10px 15px; border-radius: 4px; font-size: 13px; color: #fca5a5;">
                        <strong style="color: #ef4444;">Uyarı:</strong> Oyun açıkken yapılan değişiklikler oyun yeniden başlatılana kadar geçerli olmaz.
                    </div>
                    
                    <div id="settings-error-banner" style="display: none; margin-top: 15px; background: rgba(239, 68, 68, 0.15); border: 1px solid #ef4444; padding: 10px 15px; border-radius: 4px; font-size: 13px; color: #fca5a5;">
                    </div>
                    
                    <hr class="dlss-divider" style="border: 0; border-top: 1px solid rgba(255,255,255,0.05); margin: 20px 0;">

                    <div id="settings-content" style="flex: 1; overflow-y: auto; padding-right: 10px; display: flex; flex-direction: column; gap: 20px;">
                        <!-- Dinamik olarak doldurulacak -->
                    </div>
                </div>
            </div>
        </div>
    </div>
`;

    indexHtml = beforeManage + manageBlock + settingsModalHtml + '\n' + afterManage;
}

fs.writeFileSync(indexHtmlPath, indexHtml, 'utf8');

// 3. Rename manage.js to update.js and modify contents
const manageJsPath = path.join(__dirname, 'src', 'renderer', 'ui', 'modals', 'manage.js');
const updateJsPath = path.join(__dirname, 'src', 'renderer', 'ui', 'modals', 'update.js');

if (fs.existsSync(manageJsPath)) {
    let manageJs = fs.readFileSync(manageJsPath, 'utf8');
    manageJs = manageJs.replace(/manage-/g, 'update-');
    manageJs = manageJs.replace(/manageModal/g, 'updateModal');
    manageJs = manageJs.replace(/openManageModal/g, 'openUpdateModal');
    manageJs = manageJs.replace(/initManageListeners/g, 'initUpdateListeners');
    
    fs.writeFileSync(updateJsPath, manageJs, 'utf8');
    fs.unlinkSync(manageJsPath);
}

// 4. Update index.js references
const indexJsPath = path.join(__dirname, 'src', 'renderer', 'index.js');
if (fs.existsSync(indexJsPath)) {
    let indexJs = fs.readFileSync(indexJsPath, 'utf8');
    indexJs = indexJs.replace(/import \{ initManageListeners \} from '\.\/ui\/modals\/manage\.js';/g, "import { initUpdateListeners } from './ui/modals/update.js';");
    indexJs = indexJs.replace(/initManageListeners\(\);/g, "initUpdateListeners();");
    
    // Remove uninstall listeners
    indexJs = indexJs.replace(/import \{ initUninstallListeners \} from '\.\/ui\/modals\/uninstall\.js';\n/g, "");
    indexJs = indexJs.replace(/    initUninstallListeners\(\);\n/g, "");
    
    fs.writeFileSync(indexJsPath, indexJs, 'utf8');
}

// 5. Delete uninstall.js
const uninstallJsPath = path.join(__dirname, 'src', 'renderer', 'ui', 'modals', 'uninstall.js');
if (fs.existsSync(uninstallJsPath)) {
    fs.unlinkSync(uninstallJsPath);
}

console.log('Refactor script completed successfully.');
