"""
Django settings for vertex_cloud project (Ecosistema VERTEX - MILLAY).

Backend de calculos pesados de audio (letras sincronizadas, BPM, clave y transiciones con Librosa).
"""
import os
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse
from django.core.exceptions import ImproperlyConfigured
from django.core.management.utils import get_random_secret_key

# Build paths inside the project like this: BASE_DIR / 'subdir'.
BASE_DIR = Path(__file__).resolve().parent.parent

ENVIRONMENT = os.environ.get('DJANGO_ENV', 'development').strip().lower()
IS_PRODUCTION = ENVIRONMENT in {'production', 'prod'}


def env_list(name, default=''):
    return [value.strip() for value in os.environ.get(name, default).split(',') if value.strip()]


# Las claves de producción jamás tienen un valor por defecto versionado. En desarrollo se genera
# una clave efímera para que el backend local pueda arrancar sin exponer credenciales reales.
SECRET_KEY = os.environ.get('DJANGO_SECRET_KEY')
if not SECRET_KEY:
    if IS_PRODUCTION:
        raise ImproperlyConfigured('DJANGO_SECRET_KEY debe configurarse en producción.')
    SECRET_KEY = get_random_secret_key()

DEBUG = False if IS_PRODUCTION else os.environ.get('DJANGO_DEBUG', 'true').lower() in ('true', '1', 'yes')

ALLOWED_HOSTS = env_list(
    'DJANGO_ALLOWED_HOSTS',
    'localhost,127.0.0.1' if DEBUG else '',
)
if not DEBUG and not ALLOWED_HOSTS:
    raise ImproperlyConfigured('DJANGO_ALLOWED_HOSTS debe configurarse cuando DEBUG=False.')


# Application definition

INSTALLED_APPS = [
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    # Third party
    'rest_framework',
    'corsheaders',
    # Local apps
    'api.apps.ApiConfig',
]

MIDDLEWARE = [
    'corsheaders.middleware.CorsMiddleware',
    'django.middleware.security.SecurityMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
]

ROOT_URLCONF = 'vertex_cloud.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'vertex_cloud.wsgi.application'
ASGI_APPLICATION = 'vertex_cloud.asgi.application'


# Database - PostgreSQL in hosted environments, SQLite for local development.
# https://docs.djangoproject.com/en/5.0/ref/settings/#databases

DATABASE_URL = os.environ.get('DATABASE_URL', '').strip()
POSTGRES_DB = os.environ.get('POSTGRES_DB', '').strip()

if DATABASE_URL:
    parsed_database_url = urlparse(DATABASE_URL)
    if parsed_database_url.scheme not in {'postgres', 'postgresql'}:
        raise ImproperlyConfigured('DATABASE_URL debe usar postgres:// o postgresql://.')

    database_name = unquote(parsed_database_url.path.lstrip('/'))
    if not database_name:
        raise ImproperlyConfigured('DATABASE_URL debe incluir el nombre de la base de datos.')

    database_query = parse_qs(parsed_database_url.query)
    database_options = {'connect_timeout': 10}
    ssl_mode = database_query.get('sslmode', [os.environ.get('POSTGRES_SSLMODE', '')])[0]
    if not ssl_mode and IS_PRODUCTION:
        ssl_mode = 'require'
    if ssl_mode:
        database_options['sslmode'] = ssl_mode

    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': database_name,
            'USER': unquote(parsed_database_url.username or ''),
            'PASSWORD': unquote(parsed_database_url.password or ''),
            'HOST': parsed_database_url.hostname or 'localhost',
            'PORT': str(parsed_database_url.port or 5432),
            'CONN_MAX_AGE': int(os.environ.get('POSTGRES_CONN_MAX_AGE', '60')),
            'OPTIONS': database_options,
        }
    }
elif POSTGRES_DB:
    database_options = {'connect_timeout': 10}
    ssl_mode = os.environ.get('POSTGRES_SSLMODE', 'require' if IS_PRODUCTION else '').strip()
    if ssl_mode:
        database_options['sslmode'] = ssl_mode

    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.postgresql',
            'NAME': POSTGRES_DB,
            'USER': os.environ.get('POSTGRES_USER', 'postgres'),
            'PASSWORD': os.environ.get('POSTGRES_PASSWORD', ''),
            'HOST': os.environ.get('POSTGRES_HOST', 'localhost'),
            'PORT': os.environ.get('POSTGRES_PORT', '5432'),
            'CONN_MAX_AGE': int(os.environ.get('POSTGRES_CONN_MAX_AGE', '60')),
            'OPTIONS': database_options,
        }
    }
else:
    # Fallback seguro para desarrollo local / offline
    DATABASES = {
        'default': {
            'ENGINE': 'django.db.backends.sqlite3',
            'NAME': BASE_DIR / 'vertex_cache.sqlite3',
        }
    }


# Password validation
AUTH_PASSWORD_VALIDATORS = [
    {
        'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator',
    },
]


# Internationalization
LANGUAGE_CODE = 'es-es'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True


# Static files (CSS, JavaScript, Images)
STATIC_URL = 'static/'
STATIC_ROOT = BASE_DIR / 'staticfiles'

# Media files (para subidas temporales de fragmentos de audio para análisis DSP)
MEDIA_URL = 'media/'
MEDIA_ROOT = BASE_DIR / 'media'

# Default primary key field type
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# Configuración CORS para React Native / Expo. Los clientes nativos no envían Origin, pero Expo
# web y los paneles de desarrollo deben declararse explícitamente mediante variables de entorno.
CORS_ALLOW_ALL_ORIGINS = False
CORS_ALLOWED_ORIGINS = env_list(
    'DJANGO_CORS_ALLOWED_ORIGINS',
    'http://localhost:8081,http://127.0.0.1:8081,http://localhost:19006' if DEBUG else '',
)
CSRF_TRUSTED_ORIGINS = CORS_ALLOWED_ORIGINS
CORS_ALLOW_HEADERS = [
    'accept',
    'accept-encoding',
    'authorization',
    'content-type',
    'dnt',
    'origin',
    'user-agent',
    'x-csrftoken',
    'x-requested-with',
]

SECURE_CONTENT_TYPE_NOSNIFF = True
X_FRAME_OPTIONS = 'DENY'
SESSION_COOKIE_SECURE = IS_PRODUCTION
CSRF_COOKIE_SECURE = IS_PRODUCTION
SECURE_SSL_REDIRECT = IS_PRODUCTION
SECURE_HSTS_SECONDS = 31536000 if IS_PRODUCTION else 0
SECURE_HSTS_INCLUDE_SUBDOMAINS = IS_PRODUCTION
SECURE_HSTS_PRELOAD = IS_PRODUCTION
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https') if IS_PRODUCTION else None

# Configuración Django REST Framework
REST_FRAMEWORK = {
    'DEFAULT_RENDERER_CLASSES': [
        'rest_framework.renderers.JSONRenderer',
    ],
    'DEFAULT_PARSER_CLASSES': [
        'rest_framework.parsers.JSONParser',
        'rest_framework.parsers.MultiPartParser',
        'rest_framework.parsers.FormParser',
    ],
}
