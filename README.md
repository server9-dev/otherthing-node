# OtherThing Node

Desktop application to share your compute with OtherThing workspaces.

## Features

- **Hardware Detection** - Automatically detects CPU, RAM, Storage, and GPUs
- **Resource Limits** - Control how much of your hardware to share (CPU cores, RAM %, Storage GB, GPU VRAM %)
- **Workspace Integration** - Connect to workspaces and contribute compute
- **Share Key** - Simple 8-character key to add your node to workspaces
- **Remote Control** - Opt-in to allow workspace admins to manage your node from the dashboard

## Download

- **Windows**: [OtherThing-Node-Setup.exe](https://github.com/Huck-dev/rhizos-node/releases/latest)
- **Linux**: [OtherThing-Node.AppImage](https://github.com/Huck-dev/rhizos-node/releases/latest)

## Development

```bash
# Install dependencies
npm install

# Run in development
npm start

# Build for Windows
npm run dist:win

# Build for Linux
npm run dist:linux
```

## How It Works

1. Download and install the node app
2. Launch and click "Start Node" to connect to the network
3. Your **Share Key** appears - give this to workspace admins to add your node
4. Optionally enable **Remote Control** in Settings to allow dashboard management
5. Adjust **Resource Limits** to control how much you share

## License

MIT
