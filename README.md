# Automated Discord Role Management with YouTube Integration

A Discord bot that automates role management by rewarding your community's activity and engagement on your YouTube channel. Link your Discord server to your YouTube channel and automatically assign roles to members who have subscribed to your channel.

## ✨ Key Features

-   **Automatic Role Assignment**: Automatically assigns a specific role on your Discord server to new subscribers of your YouTube channel.
-   **Verification System**: Users can securely link their YouTube account to their Discord profile.
-   **Easy Configuration**: Quickly set up the bot with commands or a configuration file.
-   **Reliable and Secure**: Built on proven libraries and protects your users' data.

## 🚀 Getting Started

### Prerequisites

-   [Node.js](https://nodejs.org/) (version 16.9.0 or higher)
-   A Discord Bot Token (Create one on the [Discord Developer Portal](https://discord.com/developers/applications))
-   A Google Cloud Project with the YouTube Data API v3 enabled and corresponding API credentials.

### Installation

1.  **Clone the repository:**
    ```sh
    git clone https://github.com/YOUR-USERNAME/Automated-Discord-Role-Management-with-YouTube-Integration.git
    cd Automated-Discord-Role-Management-with-YouTube-Integration
    ```

2.  **Install dependencies:**
    ```sh
    npm install
    ```

3.  **Configure your environment variables:**
    Create a file named `.env` in the root directory and add the following:
    ```env
    DISCORD_TOKEN=YOUR_DISCORD_BOT_TOKEN
    YOUTUBE_API_KEY=YOUR_YOUTUBE_API_KEY
    YOUTUBE_CHANNEL_ID=YOUR_YOUTUBE_CHANNEL_ID
    DISCORD_ROLE_ID=THE_ID_OF_THE_ROLE_TO_BE_ASSIGNED
    ```

4.  **Start the bot:**
    ```sh
    node index.js
    ```

## ⚙️ Usage

-   `/verify [youtube-channel-url]` - Starts the verification process to link your YouTube channel.
-   `/check-roles` - Forces a role re-check for all verified members.
