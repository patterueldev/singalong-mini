from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.websockets import WebSocket
from fastapi.middleware.cors import CORSMiddleware

from .bootstrap import seed_admin_user
from .config import settings
from .db import Base, engine
from .routers.users import router as users_router

app = FastAPI(title=settings.app_name)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[origin.strip() for origin in settings.cors_origins.split(",") if origin.strip() != ""],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(users_router)

admin_static_path = Path(settings.admin_static_dir)
if admin_static_path.exists():
    app.mount("/admin", StaticFiles(directory=str(admin_static_path), html=True), name="admin-static")


@app.get("/")
def root():
    return RedirectResponse(url="/guest", status_code=307)


@app.get("/api")
def api_root():
    return {"message": "Singalong API root"}


@app.get("/guest", response_class=HTMLResponse)
def guest():
    return """
    <!doctype html>
    <html><head><title>Singalong Guest</title></head>
    <body style="font-family: sans-serif; margin: 2rem;">
      <h1>Singalong Guest</h1>
      <p>Guest app is not implemented yet. This is a mock page.</p>
    </body></html>
    """


@app.get("/suggest", response_class=HTMLResponse)
def suggest():
    return """
    <!doctype html>
    <html><head><title>Singalong Suggest</title></head>
    <body style="font-family: sans-serif; margin: 2rem;">
      <h1>Song Suggestions</h1>
      <p>Suggestions app is not implemented yet. This is a mock page.</p>
    </body></html>
    """


@app.websocket("/ws")
async def websocket_placeholder(websocket: WebSocket):
    await websocket.accept()
    await websocket.send_json({"message": "WebSocket placeholder ready"})
    await websocket.close()


@app.get("/health")
def health():
    return {"status": "ok", "environment": settings.app_env}


@app.on_event("startup")
def on_startup():
    Base.metadata.create_all(bind=engine)
    seed_admin_user()
