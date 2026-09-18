const fs = require('fs');
const path = require('path');

/**
 * Steam Game Scanner
 * Identifies Steam games and their AppIDs from local folders
 */
class SteamScanner {
    constructor() {
        this.libraryFolders = [];
        this._initLibraryFolders();
    }

    _initLibraryFolders() {
        const steamPath = 'C:\\Program Files (x86)\\Steam';
        const vdfPath = path.join(steamPath, 'steamapps', 'libraryfolders.vdf');
        
        this.libraryFolders = [steamPath];

        if (fs.existsSync(vdfPath)) {
            try {
                const vdfContent = fs.readFileSync(vdfPath, 'utf-8');
                const pathRegex = /"path"\s+"([^"]+)"/g;
                let match;
                while ((match = pathRegex.exec(vdfContent)) !== null) {
                    const libPath = match[1].replace(/\\\\/g, '\\');
                    if (!this.libraryFolders.includes(libPath)) {
                        this.libraryFolders.push(libPath);
                    }
                }
            } catch (e) {
                console.error("[SteamScanner] Error parsing libraryfolders.vdf", e);
            }
        }
    }

    /**
     * Tries to find the AppID for a given folder path
     * @param {string} folderPath 
     */
    async getAppIdForFolder(folderPath) {
        const folderName = path.basename(folderPath).toLowerCase();
        
        for (const libPath of this.libraryFolders) {
            const steamAppsPath = path.join(libPath, 'steamapps');
            if (!fs.existsSync(steamAppsPath)) continue;

            const files = fs.readdirSync(steamAppsPath);
            for (const file of files) {
                if (file.endsWith('.acf')) {
                    try {
                        const content = fs.readFileSync(path.join(steamAppsPath, file), 'utf-8');
                        const installDirMatch = content.match(/"installdir"\s+"([^"]+)"/i);
                        
                        if (installDirMatch && installDirMatch[1].toLowerCase() === folderName) {
                            const appidMatch = content.match(/"appid"\s+"([^"]+)"/i);
                            const nameMatch = content.match(/"name"\s+"([^"]+)"/i);
                            
                            return {
                                appId: appidMatch ? appidMatch[1] : null,
                                name: nameMatch ? nameMatch[1] : folderName
                            };
                        }
                    } catch (e) {}
                }
            }
        }
        return null;
    }
}

module.exports = new SteamScanner();
