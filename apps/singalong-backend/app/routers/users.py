from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from ..db import get_db
from ..models import User
from ..schemas import (
    GuestCreateRequest,
    GuestCreateResponse,
    GuestLoginRequest,
    GuestLoginResponse,
    GuestUsernameSuggestionResponse,
    LoginResponse,
    LogoutResponse,
    UserResponse,
    UserLoginRequest,
    UserLogoutRequest,
)
from ..services.auth import create_access_token, get_current_user
from ..security import verify_password

router = APIRouter(prefix="/api/users", tags=["users"])


def suggest_guest_username(db: Session, nickname: str) -> str:
    username = nickname.strip()
    if username == "":
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Nickname is required")

    existing = db.scalar(select(User).where(User.username == username))
    if existing is not None:
        if existing.role != "guest":
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Nickname is already in use")
        return existing.username

    return username


@router.post("/login", response_model=LoginResponse)
def login_user(payload: UserLoginRequest, db: Session = Depends(get_db)):
    user = db.scalar(select(User).where(User.username == payload.username))
    if user is None or user.password_hash is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid credentials")

    return LoginResponse(access_token=create_access_token(user), user=user, message="Login successful")


@router.post("/guest/login", response_model=GuestLoginResponse)
def login_guest(payload: GuestLoginRequest, db: Session = Depends(get_db)):
    nickname = payload.nickname.strip()
    if nickname == "":
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Nickname is required")

    guest_user = db.scalar(select(User).where(User.username == nickname))
    if guest_user is None:
        guest_user = User(
            username=nickname,
            role="guest",
            password_hash=None,
        )
        db.add(guest_user)
        db.commit()
        db.refresh(guest_user)
    elif guest_user.role != "guest":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Nickname is already in use")

    return GuestLoginResponse(
        access_token=create_access_token(guest_user),
        user=guest_user,
        nickname=guest_user.username,
        message="Guest login successful",
    )


@router.post("/logout", response_model=LogoutResponse)
def logout_user(
    payload: UserLogoutRequest,
    current_user: User = Depends(get_current_user),
):
    _ = payload
    _ = current_user
    return LogoutResponse(message="Logout successful")


@router.get("/me", response_model=UserResponse)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.post("/guest", response_model=GuestCreateResponse, status_code=status.HTTP_201_CREATED)
def create_guest(payload: GuestCreateRequest, db: Session = Depends(get_db)):
    username = suggest_guest_username(db, payload.nickname)
    guest_user = db.scalar(select(User).where(User.username == username))
    if guest_user is None:
        guest_user = User(username=username, role="guest", password_hash=None)
        db.add(guest_user)
        db.commit()
        db.refresh(guest_user)

    return GuestCreateResponse(user=guest_user, message="Guest user created")


@router.get("/guest/username", response_model=GuestUsernameSuggestionResponse)
def get_guest_username(
    nickname: str = Query(..., min_length=1, max_length=50),
    db: Session = Depends(get_db),
):
    return GuestUsernameSuggestionResponse(username=suggest_guest_username(db, nickname))
