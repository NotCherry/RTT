pipeline {
  agent any
  options { timestamps(); ansiColor('xterm') }
  environment {
    PREVIEW_FRONTEND_PORT = '8100'
    PREVIEW_BACKEND_PORT  = '8101'
    TAILSCALE_MODE = 'serve' // serve | funnel | off
  }
  stages {
    stage('Checkout') { steps { checkout scm } }
    stage('Web CI') {
      steps {
        dir('apps/web') {
          sh 'npm ci'
          sh 'npm run test:unit'
          sh 'npm run build'
        }
      }
    }
    stage('API CI') {
      steps {
        dir('apps/api') {
          sh 'pip install -r requirements.txt -r requirements-dev.txt || pip3 install -r requirements.txt -r requirements-dev.txt'
          sh 'python -m pytest -q tests || python3 -m pytest -q tests'
        }
      }
    }
    stage('Docker build') {
      steps { sh 'docker compose --project-directory . -f infra/docker-compose.yml build' }
    }
    stage('Preview deploy (local)') {
      when { anyOf { branch 'preview/*'; expression { return env.CHANGE_ID != null } } }
      steps {
        sh './infra/scripts/preview.sh --port ${PREVIEW_FRONTEND_PORT}'
        sh 'curl --fail http://localhost:${PREVIEW_BACKEND_PORT}/api/health'
        script {
          if (env.TAILSCALE_MODE == 'serve') { sh 'tailscale serve --bg http://127.0.0.1:${PREVIEW_FRONTEND_PORT} || true; tailscale serve status || true' }
          else if (env.TAILSCALE_MODE == 'funnel') { sh 'tailscale funnel --bg http://127.0.0.1:${PREVIEW_FRONTEND_PORT} || true; tailscale funnel status || true' }
        }
      }
    }
  }
  post {
    failure { sh 'docker compose --project-directory . -f infra/docker-compose.yml -f infra/docker-compose.preview.yml --profile preview logs || true' }
  }
}
