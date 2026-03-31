import { AttachmentBuilder } from 'discord.js';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Command } from '../../lib/handlers.js';
/**
 * /sync-emojis — scans all guilds the bot is in, collects every custom emoji,
 * matches them by name against the current emojis.ts, and writes an updated file.
 *
 * Usage: /sync-emojis  (ownerOnly)
 * After running, download the attached emojis.ts and commit it to replace the old one.
 */
export default class SyncEmojisCommand extends Command {
    constructor() {
        super('sync-emojis', {
            category: 'owner',
            ownerOnly: true,
            defer: true,
            ephemeral: true
        });
    }
    args() {
        return {};
    }
    async exec(interaction) {
        await interaction.editReply('🔍 Scanning all servers for emojis...');
        // Collect every custom emoji across all guilds
        const emojiMap = new Map(); // name → <:name:id>
        for (const guild of this.client.guilds.cache.values()) {
            try {
                // Fetch emojis if not cached
                const emojis = guild.emojis.cache.size > 0 ? guild.emojis.cache : await guild.emojis.fetch();
                for (const emoji of emojis.values()) {
                    if (!emoji.name || emoji.animated)
                        continue;
                    // Don't overwrite — first guild wins (you can re-run to override)
                    if (!emojiMap.has(emoji.name)) {
                        emojiMap.set(emoji.name, `<:${emoji.name}:${emoji.id}>`);
                    }
                }
            }
            catch {
                // Bot may not have access to some guilds' emoji lists
            }
        }
        await interaction.editReply(`✅ Found **${emojiMap.size}** unique emojis across **${this.client.guilds.cache.size}** servers.\n🔄 Updating emojis.ts...`);
        // Read current emojis.ts
        const emojisPath = fileURLToPath(new URL('../../util/emojis.js', import.meta.url));
        const tsPath = emojisPath.replace('/dist/', '/src/').replace('.js', '.ts');
        let source;
        try {
            source = (await readFile(tsPath)).toString();
        }
        catch {
            // Try reading from dist if src not available
            source = (await readFile(emojisPath)).toString();
        }
        // Replace emoji IDs: match `<:EmojiName:OldId>` and swap with new ID if found
        let replaced = 0;
        let notFound = 0;
        const notFoundList = [];
        const updated = source.replace(/<:([A-Za-z][A-Za-z0-9_]*):(\d+)>/g, (match, name) => {
            const newEmoji = emojiMap.get(name);
            if (newEmoji) {
                replaced++;
                return newEmoji;
            }
            notFound++;
            notFoundList.push(name);
            return match; // keep original if not found
        });
        // Send updated file as attachment
        const attachment = new AttachmentBuilder(Buffer.from(updated, 'utf-8'), { name: 'emojis.ts' });
        const summary = [
            `✅ **${replaced}** emojis updated`,
            `⚠️ **${notFound}** not found in your servers`,
            notFoundList.length
                ? `\nMissing: ${notFoundList.slice(0, 20).join(', ')}${notFoundList.length > 20 ? `... +${notFoundList.length - 20} more` : ''}`
                : ''
        ].join('\n');
        return interaction.editReply({
            content: summary + '\n\nDownload the file below and replace `src/util/emojis.ts` in your repo.',
            files: [attachment]
        });
    }
}
//# sourceMappingURL=sync-emojis.js.map