// index.js
const { Client, GatewayIntentBits, Events, ActivityType, EmbedBuilder } = require('discord.js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// --- 設定 ---
const DB_FILE = 'user_times.json';
const DB_PATH = path.join(__dirname, DB_FILE);
const SAVE_INTERVAL = 60 * 1000; // 1分

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildMembers,
    ],
});

let userTimes = new Map();

// --- データ永続化のための関数 ---

function loadData() {
    try {
        if (fs.existsSync(DB_PATH)) {
            const data = fs.readFileSync(DB_PATH, 'utf8');
            const parsedData = JSON.parse(data);
            userTimes = new Map(Object.entries(parsedData));
            for (const userData of userTimes.values()) {
                userData.joinTime = null;
            }
            console.log(`${DB_FILE} からデータを正常に読み込みました。`);
        } else {
            console.log(`${DB_FILE} が見つかりません。新しいデータファイルを作成します。`);
        }
    } catch (error) {
        console.error(`${DB_FILE} の読み込み中にエラーが発生しました:`, error);
    }
}

function saveData() {
    try {
        const dataToSave = new Map();
        for (const [userId, data] of userTimes.entries()) {
            let currentTotalTime = data.totalTime;
            if (data.joinTime) {
                currentTotalTime += Date.now() - data.joinTime;
            }
            dataToSave.set(userId, { totalTime: currentTotalTime, joinTime: null });
        }
        
        const dataObject = Object.fromEntries(dataToSave);
        // fs.writeFileSync を使用して同期的に書き込み、クラッシュ直前のデータ損失を防ぐ
        fs.writeFileSync(DB_PATH, JSON.stringify(dataObject, null, 2));
        // console.log(`データを ${DB_FILE} に保存しました。`); // 頻繁に呼ばれるのでログはコメントアウトしても良い
    } catch (error) {
        console.error(`${DB_FILE} への保存中にエラーが発生しました:`, error);
    }
}

// --- Botのイベントリスナー ---

client.once(Events.ClientReady, () => {
    console.log(`ログインしました: ${client.user.tag}`);
    loadData();
    setInterval(() => {
        updateStatus();
        saveData(); // 長時間接続しているユーザーのデータを定期的にバックアップ
    }, SAVE_INTERVAL);
    updateStatus();
});

client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    if (newState.guild.id !== process.env.GUILD_ID || newState.member.user.bot) return;

    const userId = newState.id;
    if (!userTimes.has(userId)) {
        userTimes.set(userId, { totalTime: 0, joinTime: null });
    }
    const userData = userTimes.get(userId);

    const wasCountable = oldState.channelId && !oldState.serverMute && !oldState.selfMute;
    const isCountable = newState.channelId && !newState.serverMute && !newState.selfMute;

    if (wasCountable && !isCountable) {
        if (userData.joinTime) {
            const sessionTime = Date.now() - userData.joinTime;
            userData.totalTime += sessionTime;
            userData.joinTime = null;
            console.log(`${newState.member.displayName} の計測を停止。セッション時間: ${Math.floor(sessionTime / 1000)}秒`);
            
            // ★ 変更点: 計測が完了した瞬間にデータを保存する
            saveData();
            console.log(`データが即時保存されました。`);
        }
    } else if (!wasCountable && isCountable) {
        userData.joinTime = Date.now();
        console.log(`${newState.member.displayName} の計測を開始。`);
    }
});

// スラッシュコマンドの処理 (変更なし)
client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'te') return;
    // ... (前回のコードと同じなので省略) ...
    const guild = interaction.guild;
    if (!guild) return;

    const displayData = [];
    for (const [userId, data] of userTimes.entries()) {
        let userTotalTime = data.totalTime;
        if (data.joinTime) {
            userTotalTime += Date.now() - data.joinTime;
        }
        if (userTotalTime > 0) {
            displayData.push({ userId, totalTime: userTotalTime });
        }
    }

    displayData.sort((a, b) => b.totalTime - a.totalTime);

    if (displayData.length === 0) {
        await interaction.reply('まだ誰も作業時間を記録していません。');
        return;
    }

    const embed = new EmbedBuilder()
        .setTitle('ユーザー別 作業時間ランキング')
        .setColor(0x0099FF)
        .setTimestamp();

    let description = '';
    for (const item of displayData.slice(0, 25)) {
        try {
            const member = await guild.members.fetch(item.userId);
            const time = formatTime(item.totalTime);
            description += `**${member.displayName}**: ${time}\n`;
        } catch (error) {
            console.error(`メンバーの取得に失敗しました: ${item.userId}`);
        }
    }
    embed.setDescription(description);

    await interaction.reply({ embeds: [embed] });
});


// --- 補助関数 --- (変更なし)
function updateStatus() {
    // ... (前回のコードと同じなので省略) ...
    let totalMilliseconds = 0;
    for (const data of userTimes.values()) {
        totalMilliseconds += data.totalTime;
        if (data.joinTime) {
            totalMilliseconds += Date.now() - data.joinTime;
        }
    }
    const hours = Math.floor(totalMilliseconds / (1000 * 60 * 60));
    const minutes = Math.floor((totalMilliseconds % (1000 * 60 * 60)) / (1000 * 60));
    const statusText = `合計作業: ${hours}時間${minutes}分`;
    client.user.setActivity(statusText, { type: ActivityType.Watching });
}

function formatTime(ms) {
    // ... (前回のコードと同じなので省略) ...
    if (ms < 1000) return `1秒未満`;
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours}時間 ${minutes}分 ${seconds}秒`;
}

// Botが終了する直前にデータを保存する (変更なし)
process.on('SIGINT', () => {
    console.log('Botを終了します。データを保存中...');
    saveData();
    process.exit();
});

client.login(process.env.DISCORD_TOKEN);