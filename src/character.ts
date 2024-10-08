import {
  clamp,
  drawTile,
  hsl,
  keyIsDown,
  mod,
  mouseIsDown,
  mousePos,
  tile,
  Timer,
  vec2,
  Vector2,
} from "littlejsengine";
import { GameObject } from "./base/gameObject";
import { mainSystem } from "./systems/mainSystem";
import { IWeapon } from "./base/gameWeapon";
import { GameObjectType, MemoryType, UpgradeType, WeaponType } from "./types";
import { UPGRADES, UPGRADES_WITH_PERCENT, WEAPONS } from "./stats";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp } from "./constants";

export class Character extends GameObject {
  WEAPONS_POSITIONS = [
    vec2(-0.7, 0), // left
    vec2(0.7, 0), // right
    vec2(-0.7, 0.5), // left-top2
    vec2(0.7, 0.5), // right-top2
    vec2(0, 1), // top
    vec2(0, -0.5), // bottom
    vec2(0, 0), // center
  ];
  spd = 0.1;
  hpRegenTimer = new Timer(3);

  d: -1 | 1 = 1;
  weapons: { [key: string]: IWeapon[] } = {};

  // stats
  mHp!: number;
  stats: ISTATS = {
    [UpgradeType.Health]: 50,
    [UpgradeType.Speed]: 1,
    [UpgradeType.Damage]: 1,
    [UpgradeType.AttackSpeed]: 1,
    [UpgradeType.HpRegen]: 0,
  };

  constructor(pos: Vector2) {
    super(
      GameObjectType.Character,
      pos,
      vec2(1, 0.5),
      tile(0),
      undefined,
      hsl(29, 71, 176)
    );
    this.setCollision(true, false);

    this.drawSize = vec2(2);

    this.calcStats();
    // add weapons
    this.buildWeaponsSlots();
    mainSystem.m.forEach((m) => {
      if (m[0] === MemoryType.Weapon) {
        const w = WEAPONS[m[1]].w;
        const stats = WEAPONS[m[1]][m[2]];
        this.addWeapon(new w(stats));
      }
    });
  }

  calcStats() {
    [
      UpgradeType.Health,
      UpgradeType.Speed,
      UpgradeType.Damage,
      UpgradeType.AttackSpeed,
      UpgradeType.HpRegen,
    ].forEach((key) => {
      this.stats[key] = mainSystem.m.reduce(
        (acc, m) =>
          m[0] === MemoryType.Upgrade && m[1] === key
            ? UPGRADES_WITH_PERCENT.includes(key)
              ? acc + UPGRADES[m[1]].s / 100
              : acc + UPGRADES[m[1]].s
            : acc,
        this.stats[key]
      );
    });

    this.mHp = this.stats[UpgradeType.Health];
    this.hp = this.stats[UpgradeType.Health];
  }

  buildWeaponsSlots() {
    for (let i = 0; i < this.WEAPONS_POSITIONS.length; i++) {
      const p = this.WEAPONS_POSITIONS[i].x + "," + this.WEAPONS_POSITIONS[i].y;
      this.weapons[p] = [];
    }
  }

  addWeapon(w: IWeapon) {
    if (
      w.type === WeaponType.Field ||
      // w.type === WeaponType.CrossLaser ||
      w.type === WeaponType.Spikes
    ) {
      const center = this.WEAPONS_POSITIONS[this.WEAPONS_POSITIONS.length - 1];
      const p = center.x + "," + center.y;
      this.weapons[p].push(w);
      this.addChild(w, center);
      return;
    }
    let added = false;
    let turns = 0;
    while (!added) {
      for (let i = 0; i < this.WEAPONS_POSITIONS.length; i++) {
        const p =
          this.WEAPONS_POSITIONS[i].x + "," + this.WEAPONS_POSITIONS[i].y;
        if (this.weapons[p].length <= turns) {
          this.weapons[p].push(w);
          this.addChild(w, this.WEAPONS_POSITIONS[i]);
          added = true;
          break;
        }
      }
      turns++;
    }
  }

  update() {
    // call parent and update physics
    super.update();
    // movement control
    let moveInput = vec2(
      // @ts-ignore
      keyIsDown(ArrowRight) - keyIsDown(ArrowLeft),
      // @ts-ignore
      keyIsDown(ArrowUp) - keyIsDown(ArrowDown)
    );

    if (mouseIsDown(0)) {
      moveInput = mousePos.subtract(this.pos);
    }
    if (moveInput.length() > 0) {
      moveInput = moveInput.normalize(1);
    }

    // apply movement acceleration and clamp
    const maxCharacterSpeed = 0.2 + (this.stats[UpgradeType.Speed] - 1);
    // console.log(maxCharacterSpeed);
    this.velocity.x = clamp(
      moveInput.x * 0.42,
      -maxCharacterSpeed,
      maxCharacterSpeed
    );
    this.velocity.y = clamp(
      moveInput.y * 0.42,
      -maxCharacterSpeed,
      maxCharacterSpeed
    );
    // change angle back and forth while moving for animation
    const velocityLength = this.velocity.length();
    this.angle = 0;
    if (velocityLength > 0) {
      this.walkCyclePercent += velocityLength * 0.2;
      this.walkCyclePercent =
        velocityLength > 0.01 ? mod(this.walkCyclePercent) : 0;
      this.angle = this.walkCyclePercent < 0.5 ? 0.05 : -0;
    }

    // mirror sprite if moving left
    if (moveInput.x) {
      this.d = moveInput.x > 0 ? 1 : -1;
    }

    // weapons
    this.updateWeapons();

    if (this.hpRegenTimer.elapsed()) {
      const newHealth = Math.min(
        this.mHp,
        this.hp + this.stats[UpgradeType.HpRegen]
      );
      if (newHealth !== this.hp) {
        this.hp = newHealth;
      }
      this.hpRegenTimer.set(3);
    }
  }

  updateWeapons() {
    mainSystem.enemies.forEach((e) => {
      Object.keys(this.weapons).forEach((vecKey) => {
        const ws = this.weapons[vecKey];
        ws.forEach((w) => {
          if (w.target?.isDead()) {
            w.target = undefined;
          }

          if (w.canFire(e.pos)) {
            // if new target is closer
            const newDistance = w.pos.distance(e.pos);
            const oldDistance = w.target
              ? w.pos.distance(w.target.pos)
              : Infinity;
            const canBeAttackedAsFlying = !w.donNotAttackFlying || !e.isFlying;
            if (
              (!w.target || newDistance < oldDistance) &&
              canBeAttackedAsFlying
            ) {
              w.target = e;
            }
          }
        });
      });
    });

    Object.keys(this.weapons).forEach((vecKey) => {
      const ws = this.weapons[vecKey];
      ws.forEach((w) => {
        if (w.target) {
          w.aimAt(w.target.pos);
          w.canFire(w.target.pos) && w.fire();
        }
      });
    });
  }

  render(): void {
    drawTile(
      this.pos.subtract(vec2(0, -0.4)),
      this.drawSize || this.size,
      this.tileInfo,
      this.color,
      this.angle,
      this.d < 0,
      this.additiveColor
    );
    // super.render();
  }
}
