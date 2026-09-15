pipeline {
  agent any
  options { timestamps(); ansiColor('xterm') }
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
  }
}
