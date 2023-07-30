const { Client, GatewayIntentBits } = require('discord.js');
require("dotenv").config();
const fs = require('fs');
const Discord = require('discord.js');
const CronJob = require('node-cron');
const { REST } = require('@discordjs/rest');
const { Routes } = require('discord-api-types/v9');

const client = new Client({
intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
],
});

const strikesFilePath = 'strikes.json';
const guildId = "674079915515052058";
const staffRole = "749115443721273445";
const violations = "1134347089678172281";
const staffChat = "1134347106824491029";
const strikeRoles = ["1134420601658937475", "1134420636127731823", "1134420661406793819"];
const bannableRoleId = "1134420687507947650";

let strikesMap = readStrikesData();

function readStrikesData() {
    try {
        const data = fs.readFileSync(strikesFilePath);
        return JSON.parse(data);
    } catch (error) {
        console.error('Error reading strikes data:', error.message);
    return {};
    }
}

function writeStrikesData(strikesData) {
    try {
        fs.writeFileSync(strikesFilePath, JSON.stringify(strikesData, null, 2));
    } catch (error) {
        console.error('Error writing strikes data:', error.message);
    }
}

function checkExpiredStrikes() {
    const nowTimestamp = Date.now();
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;

    for (const userId in strikesMap) {
        const userStrikes = strikesMap[userId];
        const lastStrikeTimestamp = userStrikes.lastStrike;
        const bannableTimestamp = userStrikes.bannableTimestamp;
        if (lastStrikeTimestamp) {
            const thirtyDaysInMs = 30;// * 24 * 60 * 60 * 1000;
            const timeElapsed = nowTimestamp - lastStrikeTimestamp;
            console.log(timeElapsed);
            if (timeElapsed >= thirtyDaysInMs) {
                // Expired strike, remove it
                removeStrikeRoles(guild, userId);
                userStrikes.lastStrike = null;
                userStrikes.strikes = 0;
                writeStrikesData(strikesMap);
            }
        }
    }
}

async function removeStrikeRoles(guild, userId) {
    try {
        const member = await guild.members.fetch(userId);
        if (!member) {
            console.error('Member not found:', userId);
            return;
        }
        console.log(`Removing strike role from ${userId}`);
        for (const roleId of strikeRoles) {
            const roleToRemove = guild.roles.cache.get(roleId);
            if (!roleToRemove) {
                console.error('Role not found:', roleId);
                continue;
            }

            try {
                await member.roles.remove(roleToRemove);
            } catch (error) {
                console.error('Error removing role:', error);
            }
        }
    } catch (error) {
        console.error('Error fetching member:', error);
    }
}

function checkExpiredBannable() {
    const nowTimestamp = Date.now();
    const guild = client.guilds.cache.get(guildId);
    if (!guild) return;

    for (const userId in strikesMap) {
        const userStrikes = strikesMap[userId];
        const bannableTimestamp = userStrikes.bannableTimestamp;
        if (bannableTimestamp) {
            const ninetyDaysInMs = 90 * 24 * 60 * 60 * 1000;
            const timeElapsed = nowTimestamp - bannableTimestamp;
            console.log(timeElapsed);
            if (timeElapsed >= ninetyDaysInMs) {
                // expired bannable, remove it
                removeBannableRole(guild, userId);

                userStrikes.bannableTimestamp = null;
                writeStrikesData(strikesMap);
            }
        }
    }
}

async function removeBannableRole(guild, userId) {
    const member = guild.members.cache.get(userId);
        if (member) {
            const bannableRole = guild.roles.cache.get(bannableRoleId);
            if (bannableRole) {
                console.log(`Removing bannable role from ${userId}`);
                try {
                    await member.roles.remove(bannableRole);
                } catch (error) {
                    console.error('Error removing bannable role:', error);
                }
            }
        }
}

function checkObsoleteEntries() {
    for (const userId in strikesMap) {
        const userStrikes = strikesMap[userId];
        const lastStrikeTimestamp = userStrikes.lastStrike;
        const bannableTimestamp = userStrikes.bannableTimestamp;
        
        if (lastStrikeTimestamp === null && bannableTimestamp === null) {
            console.log(`Deleting strike data entry for ${userId}`);
            delete strikesMap[userId];
        }
    }

    writeStrikesData(strikesMap);
}

async function addStrike(userId, username, guild) {
    const userStrikes = strikesMap[userId] || { strikes: 0, lastStrike: null };
    const strikeCount = userStrikes.strikes;
    const newStrikeCount = Math.min(strikeCount + 1, 3);
    const nowTimestamp = Date.now();

    const strikeRoleIndex = newStrikeCount - 1;
    if (strikeRoleIndex >= 0 && strikeRoleIndex < strikeRoles.length) {
        const strikeRole = guild.roles.cache.get(strikeRoles[strikeRoleIndex]);
        if (strikeRole) {
            try {
                const member = guild.members.cache.get(userId);
                if (member) {
                    // Remove any existing strike roles before adding the new one
                    for (const roleId of strikeRoles) {
                        const roleToRemove = guild.roles.cache.get(roleId);
                        if (roleToRemove) {
                            await member.roles.remove(roleToRemove);
                        }
                    }

                    // Add the new strike role
                    await member.roles.add(strikeRole);
                }
            } catch (error) {
                console.error('Error adding strike role:', error);
            }
        }
    }

    // Update the strikes data in strikesMap
    strikesMap[userId] = { 
        username, 
        strikes: newStrikeCount, 
        lastStrike: nowTimestamp,
        bannableTimestamp: newStrikeCount === 3 ? nowTimestamp : null, // Set the bannable timestamp if the user has 3 strikes
    };
    writeStrikesData(strikesMap); // Save the updated strikes data

    console.log(`Given strike ${newStrikeCount} to ${username} (${userId})`);
    if (newStrikeCount === 3) {
        const bannableRole = guild.roles.cache.get(bannableRoleId);
        if (bannableRole) {
            try {
                const member = guild.members.cache.get(userId);
                if (member) {
                    await member.roles.add(bannableRole);
                    console.log(`Given bannable role to ${username}`);

                }
            } catch (error) {
                console.error('Error adding bannable role:', error);
            }
        }
    }
    return newStrikeCount;
}



// client.on('messageCreate', message => {
//     if (message.content === 'ping') {
//         message.reply('pong')
//     }
// })

const commands = [
{
    name: 'strike',
    description: 'Strike a user.',
    options: [
    {
        name: 'user',
        type: 6,
        description: 'The user to strike.',
        required: true,
    },
    {
        name: 'reason',
        type: 3,
        description: 'The reason for the strike.',
        required: true,
    },
    ],
},
{
    name: 'strikelist',
    description: 'Get the list of users with strikes.',
},
{
    name: 'checkstrikes',
    description: 'Checks for expired strikes and removes them.',
},
];

// Initialize the REST API client
const rest = new REST({ version: '9' }).setToken(process.env.TOKEN);

// Register the slash commands
(async () => {
try {
    console.log('Loading slash commands...');

    await rest.put(
    Routes.applicationGuildCommands('1134263304181792918', '674079915515052058'),
    { body: commands },
    );

    console.log('Successfully loaded slash commands.');
} catch (error) {
    console.error(error);
}
})();

client.on('ready', () => {
    console.log(`Logged in as ${client.user.tag}!`);
    
    // Schedule the functions to run every 24 hours
    CronJob.schedule('0 0 * * *', () => {
        console.log('Checking for expired strikes...');
        checkExpiredStrikes();
        console.log('Checking for expired bannable roles...');
        checkExpiredBannable();
        console.log('Checking for obsolete strike data entries...');
        checkObsoleteEntries();
    });
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isCommand()) return;

    const { commandName, options, member } = interaction;
    const guild = member.guild;

    if (commandName === 'strike') {
        if (!member.roles.cache.has(staffRole)) {
            return interaction.reply({
            content: "You don't have permission to use this command.",
            ephemeral: true,
            });
        }
        
        const user = options.get('user')?.user;
        const reason = options.get('reason')?.value;
        const userStrikes = strikesMap[user.id] || { strikes: 0, lastStrike: null };
        const strikeCount = userStrikes.strikes;

        const newStrikeCount = addStrike(user.id, user.username, guild);
        
        if (strikeCount >= 3) {
            return interaction.reply({
            content: "The user already has 3 strikes and is bannable.",
            ephemeral: true,
            });
        }

        if (strikeCount === 2) {
            return interaction.reply({
            content: `User <@${user.id}> has been given strike 3 and the bannable role for the reason: ${reason}`,
            ephemeral: true,
            });
        }
        
        return interaction.reply({
            content: `User <@${user.id}> has been given strike ${strikeCount + 1} for the reason: ${reason}`,
            ephemeral: true,
        });
    } else if (commandName === 'strikelist') {
        if (!member.roles.cache.has(staffRole)) {
            return interaction.reply({
            content: "You don't have permission to use this command.",
            ephemeral: true,
            });
        }

    } else if (commandName === 'checkstrikes') {
        console.log('Checking for expired strikes...');
        checkExpiredStrikes();
        console.log('Checking for expired bannable roles...');
        checkExpiredBannable();
        console.log('Checking for obsolete strike data entries...');
        checkObsoleteEntries();
        return interaction.reply({
            content: "Strike list has been checked and expired strikes have been removed, if any.",
            ephemeral: true,
        });
    }
});

process.on('beforeExit', () => {
    writeStrikesData(strikesMap);
});


client.login(process.env.TOKEN);