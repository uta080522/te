const { REST, Routes } = require('discord.js');
require('dotenv').config();

const commands = [];

const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);

(async () => {
    try {
        console.log('スラッシュコマンドの登録をクリアします...');

        await rest.put(
            Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
            { body: commands },
        );

        console.log('スラッシュコマンドの登録が正常にクリアされました。');
    } catch (error) {
        console.error(error);
    }
})();
