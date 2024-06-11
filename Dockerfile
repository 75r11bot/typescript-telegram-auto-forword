# Use the official Node.js image as the base image
FROM node:16


# Set the working directory
WORKDIR /usr/src/app



# Install dependencies
RUN apt-get update && \
    apt-get install -y \
    libnss3 \
    libnspr4 \
    libdbus-1-3 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libatspi2.0-0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libxkbcommon0 \
    libasound2 && \
    rm -rf /var/lib/apt/lists/*

# Copy package.json and yarn.lock files to the working directory
COPY package*.json ./

# Install dependencies
RUN yarn install

# Install Playwright and download browser binaries
RUN npx playwright install

# Copy the rest of the application files to the working directory
COPY . .

# Copy the sessions directory to the working directory
COPY sessions ./sessions/*

# Build the application
RUN yarn run build

# Expose the port the app runs on
EXPOSE 5000

ENV NODE_ENV=${NODE_ENV}


# Add the healthcheck
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 CMD curl -f ${BASE_URL} || exit 1


VOLUME /usr/src/app
VOLUME /usr/src/app/sessions

# Command to run the application
CMD [ "node", "dist/main.js" ]
